/**
 * Unit tests for matchGeofence — decides whether a clock-in happened at a
 * project site.
 *
 * The bug these exist to prevent: this used to read
 * `fleet_authorized_locations`, which has always had 0 rows, so it returned
 * inside:false for every clock-in ever recorded and raised 2,261 false
 * exceptions. A silent constant-false is exactly the failure a unit test
 * against a mocked table cannot see, so the source table itself is asserted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: { query: mocks.query } }));

import { matchGeofence } from '../geofenceUtils';

const DEVICE = { lat: -26.3820, lon: 27.8180 };
const row = (distanceM: number) => ([{
  project_id: '4eb13426-b2a1-472d-9b3c-277082ae9b55',
  project_name: 'Lawley',
  distance_m: String(distanceM.toFixed(2)),
}]);

beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockResolvedValue(row(0));
});

describe('matchGeofence', () => {
  it('reads project_aois, never the empty fleet table', async () => {
    await matchGeofence({ device: DEVICE, accuracyM: 10 });
    const [text] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('FROM project_aois');
    // The regression that produced 2,261 false exceptions.
    expect(text).not.toContain('fleet_authorized_locations');
    expect(text).not.toContain('home_site_id');
  });

  it('binds longitude before latitude — ST_MakePoint takes (x, y)', async () => {
    await matchGeofence({ device: DEVICE, accuracyM: 10 });
    const [text, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('ST_MakePoint($1::float8, $2::float8)');
    // Swapped, this silently measures from a point in the wrong hemisphere
    // and every clock-in reads as thousands of km away.
    expect(params).toEqual([DEVICE.lon, DEVICE.lat]);
    expect(params[0]).toBeGreaterThan(0);  // SA longitude is positive
    expect(params[1]).toBeLessThan(0);     // SA latitude is negative
  });

  it('reports inside when the fix falls in the hull', async () => {
    mocks.query.mockResolvedValueOnce(row(0));
    const r = await matchGeofence({ device: DEVICE, accuracyM: 12 });
    expect(r).toMatchObject({
      projectId: '4eb13426-b2a1-472d-9b3c-277082ae9b55',
      projectName: 'Lawley', distanceM: 0, inside: true, withinAccuracy: false,
    });
  });

  it('treats a miss smaller than the device error as within accuracy', async () => {
    mocks.query.mockResolvedValueOnce(row(20));
    const r = await matchGeofence({ device: DEVICE, accuracyM: 50 });
    expect(r.inside).toBe(false);
    // 20 m out on a fix accurate to ±50 m is indistinguishable from inside.
    expect(r.withinAccuracy).toBe(true);
    expect(r.distanceM).toBe(20);
  });

  it('does not excuse a miss larger than the device error', async () => {
    mocks.query.mockResolvedValueOnce(row(200));
    const r = await matchGeofence({ device: DEVICE, accuracyM: 50 });
    expect(r.inside).toBe(false);
    expect(r.withinAccuracy).toBe(false);
  });

  it('cannot claim within-accuracy when accuracy is unknown', async () => {
    mocks.query.mockResolvedValueOnce(row(20));
    const r = await matchGeofence({ device: DEVICE, accuracyM: null });
    expect(r.withinAccuracy).toBe(false);
  });

  it('returns unmatched — not inside — when no AOIs exist at all', async () => {
    mocks.query.mockResolvedValueOnce([]);
    const r = await matchGeofence({ device: DEVICE, accuracyM: 10 });
    expect(r).toEqual({
      projectId: null, projectName: null, distanceM: null,
      inside: false, withinAccuracy: false,
    });
  });

  it('survives a database failure rather than costing someone their clock-in', async () => {
    mocks.query.mockRejectedValueOnce(new Error('connection reset'));
    await expect(matchGeofence({ device: DEVICE, accuracyM: 10 })).resolves.toEqual({
      projectId: null, projectName: null, distanceM: null,
      inside: false, withinAccuracy: false,
    });
  });

  it('refuses a non-finite distance instead of propagating NaN', async () => {
    mocks.query.mockResolvedValueOnce([{ project_id: 'x', project_name: 'y', distance_m: 'NaN' }]);
    const r = await matchGeofence({ device: DEVICE, accuracyM: 10 });
    expect(r.distanceM).toBeNull();
    expect(r.inside).toBe(false);
  });

  it('takes only the nearest AOI', async () => {
    await matchGeofence({ device: DEVICE, accuracyM: 10 });
    const [text] = mocks.query.mock.calls[0] as [string];
    expect(text).toContain('ORDER BY 3 ASC');
    expect(text).toContain('LIMIT 1');
  });
});
