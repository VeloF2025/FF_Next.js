import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock, queryMock, logMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  queryMock: vi.fn(),
  logMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
  query: (...a: unknown[]) => queryMock(...a),
}));
vi.mock('@/lib/logger', () => ({ log: logMock }));

import { ingestPositions } from '../ingest';
import type { ProviderPosition } from '../types';

const ACCOUNT = 'default';

function pos(
  externalId: string,
  iso: string,
  providerEventId: string | null = `e-${externalId}-${iso}`
): ProviderPosition {
  return {
    externalId, providerEventId, recordedAt: new Date(iso),
    lat: -26.2, lon: 28.04, speedKph: 50, roadSpeedKph: 60, isSpeeding: false,
    ignition: true, odometerKm: 1000, linearG: 0, lateralG: 0, bearing: 90,
    altitudeM: 1600, gpsFixType: 3,
  };
}

function trackerRow(externalId: string, vehicleId = 'v-1', trackerId = 't-1') {
  return { external_id: externalId, vehicle_id: vehicleId, tracker_id: trackerId };
}

describe('ingestPositions', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    queryMock.mockReset();
    logMock.warn.mockClear();
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  it('skips positions whose tracker is not mapped to a vehicle', async () => {
    sqlMock.mockResolvedValueOnce([]); // no tracker rows
    const r = await ingestPositions('cartrack', ACCOUNT, [pos('unknown-1', '2026-07-15T08:00:00Z')]);
    expect(r.inserted).toBe(0);
    expect(r.skippedUnmapped).toBe(1);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('reports inserted count from what actually landed, not what was submitted', async () => {
    // ON CONFLICT DO NOTHING drops rows the DB has already seen (overlap by
    // design). RETURNING id tells us which of the 3 submitted rows landed —
    // here only 2. inserted must reflect that, not the submitted count.
    sqlMock.mockResolvedValueOnce([trackerRow('ct-1'), trackerRow('ct-2'), trackerRow('ct-3')]);
    queryMock.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);

    const positions = [
      pos('ct-1', '2026-07-15T08:00:00Z'),
      pos('ct-2', '2026-07-15T08:00:00Z'),
      pos('ct-3', '2026-07-15T08:00:00Z'),
    ];
    const r = await ingestPositions('cartrack', ACCOUNT, positions);

    expect(r.inserted).toBe(2);
    expect(r.skippedUnmapped).toBe(0);
  });

  it('scopes the tracker lookup by provider AND account_ref, not provider alone', async () => {
    sqlMock.mockResolvedValueOnce([trackerRow('ct-1')]);
    queryMock.mockResolvedValueOnce([{ id: 'a' }]);
    await ingestPositions('cartrack', 'urent', [pos('ct-1', '2026-07-15T08:00:00Z')]);

    const sqlCallArgs = sqlMock.mock.calls[0];
    expect(sqlCallArgs).toContain('cartrack');
    expect(sqlCallArgs).toContain('urent');
  });

  it('keeps two accounts on the same provider isolated: identical external_id maps to different vehicles', async () => {
    // Migration 441 scopes tracker uniqueness to (provider, account_ref,
    // external_id) precisely because Urent is a second Cartrack account
    // being onboarded alongside Velocity's. If the lookup were keyed on
    // external_id alone, one account's positions could land on the other
    // account's vehicle — silent wrong-vehicle attribution.
    sqlMock.mockResolvedValueOnce([trackerRow('v1', 'vehicle-velocity', 'tracker-velocity')]);
    queryMock.mockResolvedValueOnce([{ id: 'a' }]);
    const r1 = await ingestPositions('cartrack', 'velocity', [pos('v1', '2026-07-15T08:00:00Z', null)]);
    expect(r1.inserted).toBe(1);
    const velocityParams = queryMock.mock.calls[0][1] as unknown[];
    expect(velocityParams[0]).toBe('vehicle-velocity'); // vehicle_id is the 1st insert column
    expect(velocityParams[3]).toBe('velocity'); // account_ref is the 4th
    expect(velocityParams[4]).toBe('syn:velocity:v1:2026-07-15T08:00:00.000Z'); // provider_event_id is the 5th

    queryMock.mockClear();
    sqlMock.mockResolvedValueOnce([trackerRow('v1', 'vehicle-urent', 'tracker-urent')]);
    queryMock.mockResolvedValueOnce([{ id: 'b' }]);
    const r2 = await ingestPositions('cartrack', 'urent', [pos('v1', '2026-07-15T08:00:00Z', null)]);
    expect(r2.inserted).toBe(1);
    const urentParams = queryMock.mock.calls[0][1] as unknown[];
    expect(urentParams[0]).toBe('vehicle-urent');
    expect(urentParams[3]).toBe('urent');
    expect(urentParams[4]).toBe('syn:urent:v1:2026-07-15T08:00:00.000Z');

    // The tracker lookup itself must have been scoped per account.
    expect(sqlMock.mock.calls[0]).toContain('velocity');
    expect(sqlMock.mock.calls[1]).toContain('urent');
  });

  it('synthesises a deterministic event id (scoped by account) when providerEventId is null, stable across repeats', async () => {
    sqlMock.mockResolvedValue([trackerRow('ct-1')]);
    queryMock.mockResolvedValue([{ id: 'x' }]);
    const iso = '2026-07-15T08:00:00.000Z';
    const p = pos('ct-1', iso, null);

    await ingestPositions('cartrack', ACCOUNT, [p]);
    const firstParams = queryMock.mock.calls[0][1] as unknown[];
    const firstEventId = firstParams[4]; // provider_event_id is the 5th insert column

    queryMock.mockClear();
    await ingestPositions('cartrack', ACCOUNT, [p]);
    const secondParams = queryMock.mock.calls[0][1] as unknown[];
    const secondEventId = secondParams[4];

    expect(firstEventId).not.toBeNull();
    expect(firstEventId).toBe(`syn:${ACCOUNT}:ct-1:${iso}`);
    expect(firstEventId).toBe(secondEventId);
  });

  it('escalates to warn when every position in a non-empty batch is unmapped', async () => {
    sqlMock.mockResolvedValueOnce([]); // fleet_vehicle_trackers empty/all-inactive
    const positions = [pos('ct-1', '2026-07-15T08:00:00Z'), pos('ct-2', '2026-07-15T08:00:00Z')];

    await ingestPositions('cartrack', ACCOUNT, positions);

    expect(logMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('entire batch skipped'),
      expect.objectContaining({ skippedUnmapped: 2, total: 2 })
    );
    expect(logMock.info).not.toHaveBeenCalled();
  });

  it('logs at info when only some positions in a batch are unmapped', async () => {
    sqlMock.mockResolvedValueOnce([trackerRow('ct-1')]);
    queryMock.mockResolvedValueOnce([{ id: 'a' }]);
    const positions = [pos('ct-1', '2026-07-15T08:00:00Z'), pos('ct-unmapped', '2026-07-15T08:00:00Z')];

    await ingestPositions('cartrack', ACCOUNT, positions);

    expect(logMock.info).toHaveBeenCalledWith(
      expect.stringContaining('unmapped'),
      expect.objectContaining({ skippedUnmapped: 1, total: 2 })
    );
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('chunks large batches into multiple insert calls and sums inserted across chunks', async () => {
    const count = 501;
    const trackerRows = Array.from({ length: count }, (_, i) => trackerRow(`ct-${i}`, `v-${i}`, `t-${i}`));
    sqlMock.mockResolvedValueOnce(trackerRows);
    queryMock
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` })))
      .mockResolvedValueOnce([{ id: 'b0' }]);

    const positions = Array.from({ length: count }, (_, i) => pos(`ct-${i}`, '2026-07-15T08:00:00Z'));
    const r = await ingestPositions('cartrack', ACCOUNT, positions);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(r.inserted).toBe(501);
  });

  it('rejects timestamps more than 5 minutes in the future', async () => {
    sqlMock.mockResolvedValueOnce([trackerRow('ct-1')]);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r = await ingestPositions('cartrack', ACCOUNT, [pos('ct-1', future)]);
    expect(r.inserted).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts a fix exactly at the 5-minute future boundary, rejects one ms beyond it', async () => {
    const now = new Date('2026-07-15T08:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const atBoundary = new Date(now.getTime() + 5 * 60 * 1000);
      const beyondBoundary = new Date(atBoundary.getTime() + 1);

      sqlMock.mockResolvedValueOnce([trackerRow('ct-1')]);
      queryMock.mockResolvedValueOnce([{ id: 'a' }]);
      const r1 = await ingestPositions('cartrack', ACCOUNT, [pos('ct-1', atBoundary.toISOString())]);
      expect(r1.inserted).toBe(1);

      sqlMock.mockResolvedValueOnce([trackerRow('ct-1')]);
      const r2 = await ingestPositions('cartrack', ACCOUNT, [pos('ct-1', beyondBoundary.toISOString())]);
      expect(r2.inserted).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stamps account_ref onto every inserted row (dedup index is now account-scoped, not just provider-scoped)', async () => {
    sqlMock.mockResolvedValueOnce([trackerRow('ct-1')]);
    queryMock.mockResolvedValueOnce([{ id: 'a' }]);
    await ingestPositions('cartrack', 'urent', [pos('ct-1', '2026-07-15T08:00:00Z')]);
    const params = queryMock.mock.calls[0][1] as unknown[];
    expect(params[3]).toBe('urent'); // account_ref is the 4th insert column
  });

  describe('maxIngestedAt — the watermark input', () => {
    // poll-tracking.ts advances fleet_tracking_watermarks.last_event_ts from
    // this field alone (never from raw fetched positions). These tests pin
    // exactly what it must reflect: only positions that were genuinely
    // candidates for storage — mapped to a tracker, and not future-dated.

    it('is the max recordedAt among a normal, fully-mapped batch', async () => {
      sqlMock.mockResolvedValueOnce([trackerRow('ct-1'), trackerRow('ct-2')]);
      queryMock.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
      const r = await ingestPositions('cartrack', ACCOUNT, [
        pos('ct-1', '2026-07-15T08:00:00Z'),
        pos('ct-2', '2026-07-15T08:05:00Z'),
      ]);
      expect(r.maxIngestedAt).toEqual(new Date('2026-07-15T08:05:00Z'));
    });

    it('excludes a future-dated position — this is the Critical-2 regression test', async () => {
      // Device clock skew: one position dated a day ahead must never be
      // allowed to drag the watermark past real data. If this regresses
      // (maxIngestedAt computed before the future-cutoff filter), the
      // future timestamp leaks in here and this assertion fails.
      sqlMock.mockResolvedValueOnce([trackerRow('ct-1'), trackerRow('ct-2')]);
      queryMock.mockResolvedValueOnce([{ id: 'a' }]);
      const normal = '2026-07-15T08:00:00Z';
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const r = await ingestPositions('cartrack', ACCOUNT, [
        pos('ct-1', normal),
        pos('ct-2', future),
      ]);
      expect(r.maxIngestedAt).toEqual(new Date(normal));
    });

    it('is null for an empty batch, so the watermark holds', async () => {
      const r = await ingestPositions('cartrack', ACCOUNT, []);
      expect(r.maxIngestedAt).toBeNull();
    });

    it('is null when every position is unmapped — this is the Important-3 regression test', async () => {
      // 441 applied but trackers not mapped yet is the guaranteed first-run
      // state in production. If this regresses (maxIngestedAt computed
      // before the mapped-tracker filter), an all-unmapped batch would
      // still advance the watermark and burn the cold-start backfill
      // before mapping ever lands.
      sqlMock.mockResolvedValueOnce([]); // no trackers mapped at all
      const r = await ingestPositions('cartrack', ACCOUNT, [
        pos('ct-1', '2026-07-15T08:00:00Z'),
        pos('ct-2', '2026-07-15T08:05:00Z'),
      ]);
      expect(r.maxIngestedAt).toBeNull();
      expect(r.inserted).toBe(0);
      expect(r.skippedUnmapped).toBe(2);
    });
  });
});
