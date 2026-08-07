import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));

import { loadCompliance } from '../complianceQueries';

const ROW = {
  id: 'chk-1',
  vehicle_id: 'veh-1',
  registration: 'LN40MGGP',
  check_date: '2026-08-06',
  result: 'violation',
  distance_m: 1420,
  last_fix_at: '2026-08-06T17:30:00.000Z',
  last_fix_lat: '-26.2100000',
  last_fix_lon: '28.0500000',
  last_fix_age_seconds: 9000,
  address_label: 'My yard',
};

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.mockResolvedValue([ROW]);
});

describe('loadCompliance', () => {
  it('parses the fix coordinates as numbers', async () => {
    const [row] = await loadCompliance({ from: '2026-08-01', to: '2026-08-07' });
    expect(row!.lastFixLat).toBe(-26.21);
    expect(row!.lastFixLon).toBe(28.05);
  });

  // Every one of these is nullable on a no_address or not_verifiable row, and
  // Number(null) is 0 — which would draw a vehicle at the equator.
  it('keeps null evidence as null', async () => {
    sqlMock.mockResolvedValue([
      {
        ...ROW,
        result: 'no_address',
        distance_m: null,
        last_fix_at: null,
        last_fix_lat: null,
        last_fix_lon: null,
        last_fix_age_seconds: null,
        address_label: null,
      },
    ]);
    const [row] = await loadCompliance({ from: '2026-08-01', to: '2026-08-07' });
    expect(row!.lastFixLat).toBeNull();
    expect(row!.lastFixLon).toBeNull();
    expect(row!.distanceM).toBeNull();
    expect(row!.lastFixAt).toBeNull();
  });

  /**
   * Conditional tagged-template fragments are broken in this repo, so the
   * result filter has to be a separate query rather than an interpolated
   * clause. Asserting the two calls differ is what keeps someone from
   * "tidying" the branches back into one.
   */
  it('uses a distinct query when a result filter is supplied', async () => {
    await loadCompliance({ from: '2026-08-01', to: '2026-08-07' });
    const unfiltered = sqlMock.mock.calls[0];

    sqlMock.mockClear();
    await loadCompliance({ from: '2026-08-01', to: '2026-08-07', result: 'violation' });
    const filtered = sqlMock.mock.calls[0];

    expect(filtered).not.toEqual(unfiltered);
  });

  it('normalises a Date check_date to YYYY-MM-DD', async () => {
    sqlMock.mockResolvedValue([{ ...ROW, check_date: new Date('2026-08-06T00:00:00.000Z') }]);
    const [row] = await loadCompliance({ from: '2026-08-01', to: '2026-08-07' });
    expect(row!.checkDate).toBe('2026-08-06');
  });

  it('returns an empty list when the range holds no checks', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await loadCompliance({ from: '2026-08-01', to: '2026-08-07' })).toEqual([]);
  });
});
