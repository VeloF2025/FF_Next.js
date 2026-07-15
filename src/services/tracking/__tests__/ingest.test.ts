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
    const r = await ingestPositions('cartrack', [pos('unknown-1', '2026-07-15T08:00:00Z')]);
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
    const r = await ingestPositions('cartrack', positions);

    expect(r.inserted).toBe(2);
    expect(r.skippedUnmapped).toBe(0);
  });

  it('synthesises a deterministic event id when providerEventId is null, stable across repeats', async () => {
    sqlMock.mockResolvedValue([trackerRow('ct-1')]);
    queryMock.mockResolvedValue([{ id: 'x' }]);
    const iso = '2026-07-15T08:00:00.000Z';
    const p = pos('ct-1', iso, null);

    await ingestPositions('cartrack', [p]);
    const firstParams = queryMock.mock.calls[0][1] as unknown[];
    const firstEventId = firstParams[3]; // provider_event_id is the 4th insert column

    queryMock.mockClear();
    await ingestPositions('cartrack', [p]);
    const secondParams = queryMock.mock.calls[0][1] as unknown[];
    const secondEventId = secondParams[3];

    expect(firstEventId).not.toBeNull();
    expect(firstEventId).toBe(`syn:ct-1:${iso}`);
    expect(firstEventId).toBe(secondEventId);
  });

  it('escalates to warn when every position in a non-empty batch is unmapped', async () => {
    sqlMock.mockResolvedValueOnce([]); // fleet_vehicle_trackers empty/all-inactive
    const positions = [pos('ct-1', '2026-07-15T08:00:00Z'), pos('ct-2', '2026-07-15T08:00:00Z')];

    await ingestPositions('cartrack', positions);

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

    await ingestPositions('cartrack', positions);

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
    const r = await ingestPositions('cartrack', positions);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(r.inserted).toBe(501);
  });

  it('rejects timestamps more than 5 minutes in the future', async () => {
    sqlMock.mockResolvedValueOnce([trackerRow('ct-1')]);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r = await ingestPositions('cartrack', [pos('ct-1', future)]);
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
      const r1 = await ingestPositions('cartrack', [pos('ct-1', atBoundary.toISOString())]);
      expect(r1.inserted).toBe(1);

      sqlMock.mockResolvedValueOnce([trackerRow('ct-1')]);
      const r2 = await ingestPositions('cartrack', [pos('ct-1', beyondBoundary.toISOString())]);
      expect(r2.inserted).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
