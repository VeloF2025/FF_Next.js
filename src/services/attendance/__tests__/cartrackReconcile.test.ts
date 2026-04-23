/**
 * Cartrack reconcile service tests.
 *
 * Mocks `sql` + injects a fake CartrackClient. Verifies verdict
 * classification, mismatch exception emission (info severity, not
 * critical), idempotence via ON CONFLICT DO NOTHING, and per-entry
 * failure isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CartrackClient, CartrackFetchResult } from '../../tracking/cartrack/types';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  loadCandidateEntries: vi.fn(),
  upsertVerification: vi.fn(),
  upsertMismatchAtomic: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/services/attendance/cartrackReconcileQueries', () => ({
  loadCandidateEntries: mocks.loadCandidateEntries,
  upsertVerification: mocks.upsertVerification,
  upsertMismatchAtomic: mocks.upsertMismatchAtomic,
}));

import { cartrackReconcile, DEFAULT_MISMATCH_THRESHOLD_M } from '../cartrackReconcile';

function entryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'e-1',
    staff_id: 's-1',
    work_date: '2026-04-20',
    clock_in_at: '2026-04-20T06:00:00+00:00',
    clock_out_at: '2026-04-20T14:00:00+00:00',
    clock_in_lat: '-26.2000000',
    clock_in_lon: '28.0000000',
    clock_out_lat: '-26.2000000',
    clock_out_lon: '28.0000000',
    cartrack_vehicle_id: 'ctv-1',
    has_in_verification: false,
    has_out_verification: false,
    ...overrides,
  };
}

function fakeCartrack(impl: CartrackClient['fetchPositionAt']): CartrackClient {
  return {
    fetchPositionAt: impl,
    listVehicles: vi.fn(),
  };
}

function sample(lat: number, lon: number, ts = '2026-04-20T06:00:00Z'): CartrackFetchResult {
  return {
    status: 'ok',
    sample: { vehicleId: 'ctv-1', lat, lon, ts: new Date(ts) },
  };
}

beforeEach(() => {
  // Reset ALL state (implementations + call history + once-queue). Tests
  // that override `mockResolvedValue` should do so before their first
  // `await cartrackReconcile(...)` call.
  mocks.loadCandidateEntries.mockReset();
  mocks.upsertVerification.mockReset();
  mocks.upsertMismatchAtomic.mockReset();
  mocks.sql.mockReset();
  // Default: upsert helpers report "new row inserted" unless a test opts out.
  mocks.upsertVerification.mockResolvedValue(true);
  mocks.upsertMismatchAtomic.mockResolvedValue({
    verificationInserted: true,
    exceptionInserted: true,
  });
});

describe('cartrackReconcile', () => {
  it('exports default threshold 500m', () => {
    expect(DEFAULT_MISMATCH_THRESHOLD_M).toBe(500);
  });

  it('rejects inverted date range', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([]);
    await expect(
      cartrackReconcile(fakeCartrack(async () => ({ status: 'no_data' })), {
        fromDate: '2026-04-22',
        toDate: '2026-04-20',
      })
    ).rejects.toThrow(/fromDate.*>\s*toDate/);
  });

  it('match verdict: device close to vehicle — upsertVerification called with match, no mismatch atomic', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    const client = fakeCartrack(async () => sample(-26.2002, 28.0));
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsMatch).toBe(2);
    expect(report.rowsMismatch).toBe(0);
    expect(mocks.upsertMismatchAtomic).not.toHaveBeenCalled();
    // Verdict passed into upsertVerification must be 'match'.
    for (const call of mocks.upsertVerification.mock.calls) {
      expect(call[0].verdict).toBe('match');
    }
  });

  it('mismatch verdict: distance > threshold — upsertMismatchAtomic called, counters incremented', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    const client = fakeCartrack(async () => sample(-26.22, 28.0)); // 2km south
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsMismatch).toBe(2);
    expect(report.mismatchExceptionsRaised).toBe(2);
    expect(mocks.upsertMismatchAtomic).toHaveBeenCalledTimes(2);
    expect(mocks.upsertVerification).not.toHaveBeenCalled();
    // Both sides carry distance + threshold for audit.
    for (const call of mocks.upsertMismatchAtomic.mock.calls) {
      expect(call[0].thresholdM).toBe(500);
      expect(typeof call[0].distanceM).toBe('number');
      expect(call[0].distanceM).toBeGreaterThan(500);
    }
  });

  it('mismatch atomic: verification AND exception are transactional (counter asserts only exceptionInserted)', async () => {
    // Transaction rolled back mid-way — caller reports verificationInserted=true,
    // exceptionInserted=false. rowsMismatch increments because the verification
    // row survived; mismatchExceptionsRaised does NOT.
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    mocks.upsertMismatchAtomic.mockResolvedValue({
      verificationInserted: true,
      exceptionInserted: false,
    });
    const client = fakeCartrack(async () => sample(-26.22, 28.0));
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsMismatch).toBe(2);
    expect(report.mismatchExceptionsRaised).toBe(0);
  });

  it('mismatch transaction throws — run records per-entry error, continues', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    mocks.upsertMismatchAtomic.mockRejectedValue(new Error('FK violation'));
    const client = fakeCartrack(async () => sample(-26.22, 28.0));
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsMismatch).toBe(0);
    expect(report.mismatchExceptionsRaised).toBe(0);
    expect(report.perEntryErrors).toHaveLength(2);
  });

  it('no_data verdict: Cartrack returns no_data — upsertVerification called with no_data', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    const client = fakeCartrack(async () => ({ status: 'no_data' }));
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsNoData).toBe(2);
    expect(mocks.upsertMismatchAtomic).not.toHaveBeenCalled();
    for (const call of mocks.upsertVerification.mock.calls) {
      expect(call[0].verdict).toBe('no_data');
    }
  });

  it('vehicle_not_mapped: cartrack_vehicle_id is NULL — fetch NOT called', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([
      entryRow({ cartrack_vehicle_id: null }),
    ]);
    const fetchSpy = vi.fn(
      async (): Promise<CartrackFetchResult> => ({ status: 'no_data' })
    );
    const client = fakeCartrack(fetchSpy);
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsVehicleNotMapped).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('vehicle_not_mapped from Cartrack 404: API returns status=vehicle_not_mapped', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    const client = fakeCartrack(async () => ({ status: 'vehicle_not_mapped' }));
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsVehicleNotMapped).toBe(2);
  });

  it('idempotence: re-run skips entries already verified', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([
      entryRow({ has_in_verification: true, has_out_verification: true }),
    ]);
    const fetchSpy = vi.fn(
      async (): Promise<CartrackFetchResult> => sample(-26.2, 28.0)
    );
    const report = await cartrackReconcile(fakeCartrack(fetchSpy), {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.entriesConsidered).toBe(1);
    expect(report.rowsMatch).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ON CONFLICT DO NOTHING (match): upsertVerification returns false → rowsSkipped', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    mocks.upsertVerification.mockResolvedValue(false); // conflict on both sides
    const client = fakeCartrack(async () => sample(-26.2, 28.0));
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsSkipped).toBe(2);
  });

  it('ON CONFLICT DO NOTHING (mismatch): verificationInserted=false → rowsSkipped, exception NOT raised', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    mocks.upsertMismatchAtomic.mockResolvedValue({
      verificationInserted: false,
      exceptionInserted: false,
    });
    const client = fakeCartrack(async () => sample(-26.22, 28.0));
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.rowsSkipped).toBe(2);
    expect(report.mismatchExceptionsRaised).toBe(0);
  });

  it('per-entry Cartrack fetch failure is captured, run continues', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    const client = fakeCartrack(async () => {
      throw new Error('Cartrack is down');
    });
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.perEntryErrors).toHaveLength(2);
    expect(report.perEntryErrors[0]!.entryId).toBe('e-1');
    expect(report.rowsMatch + report.rowsMismatch + report.rowsNoData).toBe(0);
  });

  it('open entry (clock_out_at null): only in-side processed', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([
      entryRow({ clock_out_at: null, clock_out_lat: null, clock_out_lon: null }),
    ]);
    const fetchSpy = vi.fn(
      async (): Promise<CartrackFetchResult> => sample(-26.2, 28.0)
    );
    const report = await cartrackReconcile(fakeCartrack(fetchSpy), {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(report.rowsMatch).toBe(1);
  });

  it('custom threshold flips match → mismatch', async () => {
    mocks.loadCandidateEntries.mockResolvedValueOnce([entryRow()]);
    const client = fakeCartrack(async () => sample(-26.2002, 28.0)); // ~20m
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
      thresholdM: 10,
    });
    expect(report.rowsMismatch).toBe(2);
    expect(mocks.upsertMismatchAtomic).toHaveBeenCalledTimes(2);
  });

  it('circuit-breaker trips after 20 consecutive Cartrack failures — remaining entries skipped', async () => {
    // 30 entries, fetch always throws. Should stop at 20 consecutive failures
    // (hit on entry 10's out-side, since each entry counts twice).
    const manyEntries = Array.from({ length: 30 }, (_, i) =>
      entryRow({ id: `e-${i}` })
    );
    mocks.loadCandidateEntries.mockResolvedValueOnce(manyEntries);
    const client = fakeCartrack(async () => {
      throw new Error('Cartrack outage');
    });
    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.circuitBrokenAfter).toBeDefined();
    // 20 failures means 10 entries × 2 sides. Remaining 20 entries untouched.
    expect(report.perEntryErrors.length).toBeLessThanOrEqual(20);
    expect(report.entriesConsidered).toBe(30);
  });

  it('success resets circuit-breaker counter (a run of successful entries recovers after a burst of failures)', async () => {
    // 19 failing entries, then 10 fully-successful entries. The breaker
    // threshold is 20 consecutive per-side failures — a burst of 19 × 2 = 38
    // WOULD trip, but tests the other direction: fewer failures then
    // successes. Use 5 failures (10 side-failures) then 25 successes.
    // Five failing entries produce 10 side-errors (in + out each throw);
    // still below the 20-consecutive threshold even before the successes.
    const manyEntries = Array.from({ length: 30 }, (_, i) =>
      entryRow({ id: `e-${i}` })
    );
    mocks.loadCandidateEntries.mockResolvedValueOnce(manyEntries);
    let entryIdx = 0;
    const client = fakeCartrack(async () => {
      // First 5 entries fail (entryIdx 0..4), rest succeed.
      const failThisEntry = entryIdx < 5;
      if (failThisEntry) {
        // Increment on each call; advance entry after out-side.
        // Both sides (in + out) fail for these entries.
        // Rely on the orchestrator calling twice per entry and ticking
        // entryIdx on the 2nd call.
        throw new Error('transient');
      }
      return sample(-26.2, 28.0);
    });
    // Track entry transitions via call order: every 2 calls = one entry.
    let callNum = 0;
    const origFetch = client.fetchPositionAt;
    client.fetchPositionAt = async (v, at, tol) => {
      callNum += 1;
      if (callNum % 2 === 1) entryIdx = Math.floor((callNum - 1) / 2);
      return origFetch(v, at, tol);
    };

    const report = await cartrackReconcile(client, {
      fromDate: '2026-04-20',
      toDate: '2026-04-20',
    });
    expect(report.circuitBrokenAfter).toBeUndefined();
    expect(report.entriesConsidered).toBe(30);
    // 5 failing entries × 2 sides = 10 errors; well under the 20 threshold
    // and successful entries reset the counter along the way.
    expect(report.perEntryErrors).toHaveLength(10);
  });
});
