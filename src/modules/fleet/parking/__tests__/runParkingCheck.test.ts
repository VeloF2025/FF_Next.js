import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParkingCandidate } from '../parkingQueries';

const loadParkingCheckCandidates = vi.fn();
const insertComplianceCheck = vi.fn();

vi.mock('../parkingQueries', () => ({
  loadParkingCheckCandidates: (...a: unknown[]) => loadParkingCheckCandidates(...a),
  insertComplianceCheck: (...a: unknown[]) => insertComplianceCheck(...a),
}));

import { runParkingCheck, sastDateString } from '../runParkingCheck';

const CHECK_AT = new Date('2026-08-04T18:00:00.000Z'); // 20:00 SAST

function candidate(over: Partial<ParkingCandidate> = {}): ParkingCandidate {
  return {
    vehicleId: 'veh-1',
    registration: 'MW67LFGP',
    hasTracker: true,
    location: { id: 'loc-1', lat: -26.1929, lon: 28.0305, radiusM: 200 },
    lastFix: { recordedAt: new Date(CHECK_AT.getTime() - 3600_000), lat: -26.1929, lon: 28.0305 },
    ...over,
  };
}

beforeEach(() => {
  loadParkingCheckCandidates.mockReset();
  insertComplianceCheck.mockReset();
  insertComplianceCheck.mockResolvedValue(undefined);
});

describe('sastDateString', () => {
  it('returns the SAST calendar date, not the UTC one', () => {
    // 22:30 UTC on the 4th is 00:30 SAST on the 5th.
    expect(sastDateString(new Date('2026-08-04T22:30:00.000Z'))).toBe('2026-08-05');
  });

  it('returns the same date for a 20:00 SAST instant', () => {
    expect(sastDateString(CHECK_AT)).toBe('2026-08-04');
  });
});

describe('runParkingCheck', () => {
  it('writes one row per vehicle and counts results', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate(),
      candidate({ vehicleId: 'veh-2', location: null }),
      candidate({ vehicleId: 'veh-3', hasTracker: false }),
    ]);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.evaluated).toBe(3);
    expect(report.counts.compliant).toBe(1);
    expect(report.counts.no_address).toBe(1);
    expect(report.counts.not_verifiable).toBe(1);
    expect(insertComplianceCheck).toHaveBeenCalledTimes(3);
  });

  it('passes the SAST check date through to every row', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    await runParkingCheck(CHECK_AT);
    expect(insertComplianceCheck).toHaveBeenCalledWith(
      expect.objectContaining({ checkDate: '2026-08-04', vehicleId: 'veh-1' })
    );
  });

  // One malformed vehicle must not cost us the other 21 results.
  it('continues after a failed insert and counts the error', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate({ vehicleId: 'veh-1' }),
      candidate({ vehicleId: 'veh-2' }),
    ]);
    insertComplianceCheck
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValueOnce(undefined);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.errors).toBe(1);
    expect(report.evaluated).toBe(2);
    expect(insertComplianceCheck).toHaveBeenCalledTimes(2);
  });

  it('records the deciding fix as evidence on the row', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    await runParkingCheck(CHECK_AT);
    expect(insertComplianceCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        lastFixAgeSeconds: 3600,
        distanceM: 0,
        parkingLocationId: 'loc-1',
        result: 'compliant',
      })
    );
  });

  it('handles an empty fleet without throwing', async () => {
    loadParkingCheckCandidates.mockResolvedValue([]);
    const report = await runParkingCheck(CHECK_AT);
    expect(report.evaluated).toBe(0);
    expect(report.errors).toBe(0);
  });

  it('maintains the invariant sum(counts) + errors === evaluated', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate(),
      candidate({ vehicleId: 'veh-2', location: null }),
      candidate({ vehicleId: 'veh-3', hasTracker: false }),
    ]);
    insertComplianceCheck
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValueOnce(undefined);

    const report = await runParkingCheck(CHECK_AT);

    const countSum =
      report.counts.compliant +
      report.counts.violation +
      report.counts.unknown +
      report.counts.not_verifiable +
      report.counts.no_address;

    expect(countSum + report.errors).toBe(report.evaluated);
  });

  it('does not increment result bucket when insert fails', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    insertComplianceCheck.mockRejectedValueOnce(new Error('constraint violation'));

    const report = await runParkingCheck(CHECK_AT);

    expect(report.counts.compliant).toBe(0);
    expect(report.errors).toBe(1);
  });
});
