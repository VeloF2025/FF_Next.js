import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
}));

// Passthrough so these tests exercise the handler's own behaviour. That the real
// route is auth-wrapped is pinned separately in live.auth.test.ts — a passthrough
// here would otherwise let the wrapper be deleted with every test still green.
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h }));

import handler from '../live';

/** Fixed "now" so ageSeconds/isStale assertions are exact, not approximate. */
const NOW = new Date('2026-07-15T10:00:00.000Z');

function run(method: 'GET' | 'POST' = 'GET') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method });
  return handler(req, res).then(() => res);
}

/** Builds one raw DB row exactly as pg would return it — numerics as strings. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    vehicle_id: 'veh-1',
    registration: 'ABC123GP',
    driver_name: 'John Smith',
    provider: 'cartrack',
    account_ref: 'velocity',
    lat: '-25.7479000',
    lon: '28.2293000',
    speed_kph: '45.50',
    ignition: true,
    is_speeding: false,
    recorded_at: null as Date | null,
    has_tracker: true,
    ...overrides,
  };
}

describe('GET /api/fleet/positions/live', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sqlMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects non-GET methods with 405', async () => {
    const res = await run('POST');
    expect(res._getStatusCode()).toBe(405);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a tracked vehicle returns trackingState "tracked" with numeric lat/lon/speed', async () => {
    const recordedAt = new Date(NOW.getTime() - 2 * 60 * 1000); // 2 min ago
    sqlMock.mockResolvedValue([makeRow({ recorded_at: recordedAt })]);

    const res = await run();
    expect(res._getStatusCode()).toBe(200);
    const vehicle = res._getJSONData().data.vehicles[0];

    expect(vehicle.trackingState).toBe('tracked');
    expect(vehicle.lat).toBe(-25.7479);
    expect(vehicle.lon).toBe(28.2293);
    expect(vehicle.speedKph).toBe(45.5);
    expect(typeof vehicle.lat).toBe('number');
    expect(typeof vehicle.lon).toBe('number');
    expect(typeof vehicle.speedKph).toBe('number');
  });

  it('a vehicle with an active tracker but no positions yet is "awaiting_data"', async () => {
    sqlMock.mockResolvedValue([
      makeRow({
        has_tracker: true,
        recorded_at: null,
        provider: null,
        lat: null,
        lon: null,
        speed_kph: null,
        ignition: null,
        is_speeding: null,
      }),
    ]);

    const res = await run();
    const vehicle = res._getJSONData().data.vehicles[0];

    expect(vehicle.trackingState).toBe('awaiting_data');
    expect(vehicle.lat).toBeNull();
    expect(vehicle.lon).toBeNull();
    expect(vehicle.ageSeconds).toBeNull();
  });

  it('a vehicle with no tracker is "untracked" and still present in the response', async () => {
    sqlMock.mockResolvedValue([
      makeRow({
        vehicle_id: 'veh-untracked',
        has_tracker: false,
        recorded_at: null,
        provider: null,
      }),
    ]);

    const res = await run();
    const vehicles = res._getJSONData().data.vehicles;

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({ vehicleId: 'veh-untracked', trackingState: 'untracked' });
  });

  it('never drops a vehicle regardless of trackingState — all three states come back together', async () => {
    sqlMock.mockResolvedValue([
      makeRow({
        vehicle_id: 'tracked-1',
        has_tracker: true,
        recorded_at: new Date(NOW.getTime() - 60 * 1000),
      }),
      makeRow({
        vehicle_id: 'awaiting-1',
        has_tracker: true,
        recorded_at: null,
        provider: null,
        lat: null,
        lon: null,
        speed_kph: null,
      }),
      makeRow({
        vehicle_id: 'untracked-1',
        has_tracker: false,
        recorded_at: null,
        provider: null,
        lat: null,
        lon: null,
        speed_kph: null,
      }),
    ]);

    const res = await run();
    const vehicles = res._getJSONData().data.vehicles;

    expect(vehicles.map((v: { vehicleId: string }) => v.vehicleId)).toEqual([
      'tracked-1',
      'awaiting-1',
      'untracked-1',
    ]);
  });

  it('judges the fast REST feed at 15 minutes', async () => {
    const stale = new Date(NOW.getTime() - 16 * 60 * 1000); // 16 min ago
    const fresh = new Date(NOW.getTime() - 5 * 60 * 1000); // 5 min ago
    sqlMock.mockResolvedValue([
      makeRow({ vehicle_id: 'stale-1', recorded_at: stale }),
      makeRow({ vehicle_id: 'fresh-1', recorded_at: fresh }),
    ]);

    const res = await run();
    const vehicles = res._getJSONData().data.vehicles as Array<{
      vehicleId: string;
      isStale: boolean;
    }>;

    expect(vehicles.find((v) => v.vehicleId === 'stale-1')?.isStale).toBe(true);
    expect(vehicles.find((v) => v.vehicleId === 'fresh-1')?.isStale).toBe(false);
  });

  it('does NOT call the same age stale on a 2-hourly portal feed', async () => {
    // The bug being fixed: one flat 15-minute rule judged every feed, so the
    // 2-hourly portals were stale by construction and never rendered as
    // anything but "no recent fix" however healthy they were.
    const age = new Date(NOW.getTime() - 100 * 60 * 1000); // 100 min — fine for a 2h poll
    sqlMock.mockResolvedValue([
      makeRow({
        vehicle_id: 'netstar-1',
        provider: 'netstar',
        account_ref: 'europcar',
        recorded_at: age,
      }),
      makeRow({
        vehicle_id: 'ituran-1',
        provider: 'ituran',
        account_ref: 'avis',
        recorded_at: age,
      }),
      // Same provider as the fast feed, different account, different cron.
      makeRow({
        vehicle_id: 'urent-1',
        provider: 'cartrack',
        account_ref: 'urent',
        recorded_at: age,
      }),
      makeRow({
        vehicle_id: 'velocity-1',
        provider: 'cartrack',
        account_ref: 'velocity',
        recorded_at: age,
      }),
    ]);

    const res = await run();
    const v = res._getJSONData().data.vehicles as Array<{ vehicleId: string; isStale: boolean }>;
    const stale = (id: string) => v.find((x) => x.vehicleId === id)?.isStale;

    expect(stale('netstar-1')).toBe(false);
    expect(stale('ituran-1')).toBe(false);
    expect(stale('urent-1')).toBe(false);
    // ...while the fast feed, at the very same age, IS stale.
    expect(stale('velocity-1')).toBe(true);
  });

  it('reports the threshold each vehicle was judged against', async () => {
    sqlMock.mockResolvedValue([
      makeRow({ vehicle_id: 'fast', recorded_at: NOW }),
      makeRow({
        vehicle_id: 'slow',
        provider: 'netstar',
        account_ref: 'europcar',
        recorded_at: NOW,
      }),
    ]);

    const res = await run();
    const v = res._getJSONData().data.vehicles as Array<{
      vehicleId: string;
      staleAfterSeconds: number;
    }>;

    expect(v.find((x) => x.vehicleId === 'fast')?.staleAfterSeconds).toBe(15 * 60);
    expect(v.find((x) => x.vehicleId === 'slow')?.staleAfterSeconds).toBe(3 * 3600);
  });

  it('computes ageSeconds from recorded_at relative to now', async () => {
    const recordedAt = new Date(NOW.getTime() - 90 * 1000); // 90 sec ago
    sqlMock.mockResolvedValue([makeRow({ recorded_at: recordedAt })]);

    const res = await run();
    const vehicle = res._getJSONData().data.vehicles[0];

    expect(vehicle.ageSeconds).toBe(90);
  });

  it('returns a JSON error response when the query throws', async () => {
    const error = new Error('Connection pool exhausted');
    sqlMock.mockRejectedValue(error);

    const res = await run();
    expect(res._getStatusCode()).toBe(500);

    const body = res._getJSONData();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('DATABASE_ERROR');
    expect(body.error.message).toBe('A database error occurred');
  });

  it('a vehicle with no active tracker but leftover position rows returns "untracked" with the leftover position', async () => {
    const leftoverRecordedAt = new Date(NOW.getTime() - 30 * 60 * 1000); // 30 min ago
    sqlMock.mockResolvedValue([
      makeRow({
        vehicle_id: 'veh-deactivated',
        has_tracker: false,
        recorded_at: leftoverRecordedAt,
        lat: '-25.7479000',
        lon: '28.2293000',
        speed_kph: '30.00',
      }),
    ]);

    const res = await run();
    const vehicle = res._getJSONData().data.vehicles[0];

    expect(vehicle.vehicleId).toBe('veh-deactivated');
    expect(vehicle.trackingState).toBe('untracked');
    expect(vehicle.lat).toBe(-25.7479);
    expect(vehicle.lon).toBe(28.2293);
    expect(vehicle.speedKph).toBe(30);
    expect(vehicle.recordedAt).toBe(leftoverRecordedAt.toISOString());
    expect(vehicle.ageSeconds).toBe(1800); // 30 min in seconds
  });
});
