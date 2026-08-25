/**
 * GET /api/fleet/vehicles/[id]/day-route — the SAST day boundary, the opt-in positions, and the
 * timed-out-trip flag.
 *
 * `allTripsTimedOut` is the load-bearing field: a trip closed by tracker silence ends where the
 * signal died, not where the vehicle stopped, and a whole day of them draws a confident route to
 * a place the vehicle may never have been.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '@/pages/api/fleet/vehicles/[id]/day-route';

const VEHICLE = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

async function call(query: Record<string, string | string[]>, method = 'GET') {
  const state = { status: 200, body: undefined as any };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader() { return res; },
  } as unknown as NextApiResponse;
  const req = { method, query, headers: {} } as unknown as NextApiRequest;
  await (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res);
  return state;
}

function callFor(tag: string) {
  return mocks.query.mock.calls.find(([sql]) => String(sql).includes(tag));
}

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1', ignition_on_at: '2026-08-20T06:00:00.000Z',
    ignition_off_at: '2026-08-20T07:00:00.000Z', close_reason: 'ignition_off',
    counts_toward_metrics: true,
    on_lat: '-26.2000000', on_lon: '28.0000000', off_lat: '-26.1000000', off_lon: '28.1000000',
    on_nearest_place_label: 'Depot', off_nearest_place_label: null,
    duration_seconds: '3600', distance_km: '10.50', max_speed_kph: '95.00',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockResolvedValue({
    id: VEHICLE, registration: 'AB12CD GP', make: null, model: null, status: 'active',
  });
});

describe('the SAST day boundary', () => {
  it('opens at SAST midnight and closes at the last SAST instant', async () => {
    await call({ id: VEHICLE, date: '2026-08-20' });
    const params = callFor('fleet-day-route:trips')?.[1] as unknown[];
    expect(params[1]).toBe('2026-08-20T00:00:00+02:00');
    expect(params[2]).toBe('2026-08-20T23:59:59.999+02:00');
  });

  it('uses the same boundary for positions as for trips', async () => {
    await call({ id: VEHICLE, date: '2026-08-20', includePositions: '1' });
    const trips = callFor('fleet-day-route:trips')?.[1] as unknown[];
    const positions = callFor('fleet-day-route:positions')?.[1] as unknown[];
    expect(positions[1]).toBe(trips[1]);
    expect(positions[2]).toBe(trips[2]);
  });
});

describe('positions are opt-in', () => {
  it('does not query positions unless asked', async () => {
    const res = await call({ id: VEHICLE, date: '2026-08-20' });
    expect(callFor('fleet-day-route:positions')).toBeUndefined();
    // null, not [] — "not requested" and "requested and empty" are different answers.
    expect(res.body.data.positions).toBeNull();
  });

  it('returns them when asked', async () => {
    mocks.query.mockImplementation(async (sql: string) => (
      String(sql).includes('positions')
        ? [{ recorded_at: '2026-08-20T06:30:00.000Z', lat: '-26.15', lon: '28.05',
             speed_kph: '60.00', ignition: true }]
        : []
    ));
    const res = await call({ id: VEHICLE, date: '2026-08-20', includePositions: '1' });
    expect(res.body.data.positions).toHaveLength(1);
    expect(res.body.data.positions[0].lat).toBe(-26.15);
  });
});

describe('timed-out trips are named', () => {
  it('flags a day whose trips all closed on tracker silence', async () => {
    mocks.query.mockResolvedValue([
      trip({ id: 't1', close_reason: 'timeout', counts_toward_metrics: false }),
      trip({ id: 't2', close_reason: 'timeout', counts_toward_metrics: false }),
    ]);
    const res = await call({ id: VEHICLE, date: '2026-08-20' });
    expect(res.body.data.allTripsTimedOut).toBe(true);
    expect(res.body.data.timedOutTrips).toBe(2);
  });

  it('does not flag a mixed day, but still counts the timed-out ones', async () => {
    mocks.query.mockResolvedValue([trip({ id: 't1' }), trip({ id: 't2', close_reason: 'timeout' })]);
    const res = await call({ id: VEHICLE, date: '2026-08-20' });
    expect(res.body.data.allTripsTimedOut).toBe(false);
    expect(res.body.data.timedOutTrips).toBe(1);
  });

  it('does not flag an EMPTY day — no trips is not a day of phantom trips', async () => {
    const res = await call({ id: VEHICLE, date: '2026-08-20' });
    expect(res.body.data.allTripsTimedOut).toBe(false);
    expect(res.body.data.trips).toEqual([]);
  });
});

describe('validation and access control', () => {
  it.each([
    ['a non-UUID id', { id: 'nope', date: '2026-08-20' }],
    ['a missing date', { id: VEHICLE }],
    ['a malformed date', { id: VEHICLE, date: '20/08/2026' }],
  ])('rejects %s', async (_label, q) => {
    const res = await call(q as Record<string, string>);
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('404s an unknown vehicle before reading trips', async () => {
    mocks.queryOne.mockResolvedValue(null);
    const res = await call({ id: VEHICLE, date: '2026-08-20' });
    expect(res.status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('is gated on fleet.vehicle-stats', () => {
    const src = readFileSync(resolve(__dirname, '../vehicles/[id]/day-route.ts'), 'utf8');
    expect(src).toContain("withPermission('fleet.vehicle-stats', 'view')");
    expect(src).toContain('export default withAuth(');
  });
});
