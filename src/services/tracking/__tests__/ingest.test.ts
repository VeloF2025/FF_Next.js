import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { ingestPositions } from '../ingest';
import type { ProviderPosition } from '../types';

function pos(externalId: string, iso: string): ProviderPosition {
  return {
    externalId, providerEventId: `e-${externalId}-${iso}`, recordedAt: new Date(iso),
    lat: -26.2, lon: 28.04, speedKph: 50, roadSpeedKph: 60, isSpeeding: false,
    ignition: true, odometerKm: 1000, linearG: 0, lateralG: 0, bearing: 90,
    altitudeM: 1600, gpsFixType: 3,
  };
}

describe('ingestPositions', () => {
  beforeEach(() => { sqlMock.mockReset(); });

  it('skips positions whose tracker is not mapped to a vehicle', async () => {
    sqlMock.mockResolvedValueOnce([]); // no tracker rows
    const r = await ingestPositions('cartrack', [pos('unknown-1', '2026-07-15T08:00:00Z')]);
    expect(r.inserted).toBe(0);
    expect(r.skippedUnmapped).toBe(1);
  });

  it('inserts mapped positions and reports the count', async () => {
    sqlMock
      .mockResolvedValueOnce([{ external_id: 'ct-1', vehicle_id: 'v-1', tracker_id: 't-1' }])
      .mockResolvedValue([]);
    const r = await ingestPositions('cartrack', [pos('ct-1', '2026-07-15T08:00:00Z')]);
    expect(r.inserted).toBe(1);
    expect(r.skippedUnmapped).toBe(0);
  });

  it('rejects timestamps more than 5 minutes in the future', async () => {
    sqlMock
      .mockResolvedValueOnce([{ external_id: 'ct-1', vehicle_id: 'v-1', tracker_id: 't-1' }])
      .mockResolvedValue([]);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r = await ingestPositions('cartrack', [pos('ct-1', future)]);
    expect(r.inserted).toBe(0);
  });
});
