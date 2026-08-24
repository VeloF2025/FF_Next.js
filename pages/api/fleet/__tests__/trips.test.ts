/**
 * The trips read API: validation and the SAST day boundary.
 *
 * The boundary is the reason this file exists. The business works in SAST (UTC+2) and the range
 * params are calendar dates, so reading them as UTC silently drops the first two hours of the
 * opening day and the last two of the closing one. That failure is invisible — the endpoint
 * returns a plausible list, just missing early-morning trips — and this repo has a documented
 * history of exactly that class of bug. So the tests assert the literal instants that reach SQL,
 * not merely that a query happened.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query, queryOne: mocks.queryOne }));
// withAuth and withPermission have their own suites; here they pass through so the handler is
// reachable. That the route IS wrapped in both is asserted separately below against the source,
// because a pass-through mock cannot prove a gate exists.
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '@/pages/api/fleet/trips';

async function call(query: Record<string, string | string[]>, method = 'GET') {
  const state = { status: 200, body: undefined as any, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = { method, query, headers: {} } as unknown as NextApiRequest;
  await (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res);
  return state;
}

/** The bound parameters of the first `query` call whose SQL matches `tag`. */
function paramsFor(tag: string): unknown[] | undefined {
  const call = [...mocks.query.mock.calls, ...mocks.queryOne.mock.calls]
    .find(([sql]) => String(sql).includes(tag));
  return call?.[1] as unknown[] | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockResolvedValue({
    total: '0', eligible: '0', timed_out: '0', still_open: '0',
    distance_km: '0', moving_seconds: '0', idle_seconds: '0', unattributed_seconds: '0',
    active_vehicles: '23', tracked_vehicles: '18',
  });
});

describe('the SAST day boundary', () => {
  it('opens the range at SAST midnight, not UTC midnight', async () => {
    await call({ from: '2026-08-01', to: '2026-08-31' });

    const params = paramsFor('fleet-trips:list');
    // 00:00 SAST is 22:00 UTC the previous day. Reading the date as UTC would silently drop
    // every trip that started before 02:00 local on the opening day.
    expect(params?.[0]).toBe('2026-08-01T00:00:00+02:00');
  });

  it('closes the range at the last instant of the SAST day', async () => {
    await call({ from: '2026-08-01', to: '2026-08-31' });
    const params = paramsFor('fleet-trips:list');
    expect(params?.[1]).toBe('2026-08-31T23:59:59.999+02:00');
  });

  it('uses the same boundary for the summary as for the list', async () => {
    // If these ever diverge the totals describe a different window than the rows, which is worse
    // than either being wrong alone.
    await call({ from: '2026-08-01', to: '2026-08-31' });
    const list = paramsFor('fleet-trips:list');
    const summary = paramsFor('fleet-trips:summary');
    expect(summary?.[0]).toBe(list?.[0]);
    expect(summary?.[1]).toBe(list?.[1]);
  });

  it('keeps the boundary when a vehicle filter shifts the parameter positions', async () => {
    const vehicleId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    await call({ from: '2026-08-01', to: '2026-08-31', vehicleId });

    const params = paramsFor('fleet-trips:list-vehicle');
    expect(params?.[0]).toBe(vehicleId);
    expect(params?.[1]).toBe('2026-08-01T00:00:00+02:00');
    expect(params?.[2]).toBe('2026-08-31T23:59:59.999+02:00');
  });
});

describe('input validation', () => {
  it.each([
    ['missing from', { to: '2026-08-31' }],
    ['missing to', { from: '2026-08-01' }],
    ['from not a date', { from: 'yesterday', to: '2026-08-31' }],
    ['to not a date', { from: '2026-08-01', to: 'soon' }],
    ['from with a time', { from: '2026-08-01T00:00', to: '2026-08-31' }],
  ])('rejects %s', async (_label, q) => {
    const res = await call(q as Record<string, string>);
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects an inverted range', async () => {
    const res = await call({ from: '2026-08-31', to: '2026-08-01' });
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('accepts a single-day range', async () => {
    const res = await call({ from: '2026-08-01', to: '2026-08-01' });
    expect(res.status).toBe(200);
  });

  it('rejects a range beyond the cap but accepts one exactly at it', async () => {
    // 92 days inclusive of the start: 2026-08-01 + 92 days.
    const atCap = await call({ from: '2026-05-01', to: '2026-08-01' });
    expect(atCap.status).toBe(200);

    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
    const overCap = await call({ from: '2026-01-01', to: '2026-08-01' });
    expect(overCap.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects a vehicleId that is not a UUID', async () => {
    const res = await call({ from: '2026-08-01', to: '2026-08-31', vehicleId: "'; DROP TABLE--" });
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('takes the first value when a param arrives twice', async () => {
    // Express/Next collapse ?from=a&from=b into an array; unhandled, that reaches the regex as a
    // non-string and the validation silently misbehaves.
    const res = await call({ from: ['2026-08-01', '2026-09-01'], to: '2026-08-31' });
    expect(res.status).toBe(200);
    expect(paramsFor('fleet-trips:list')?.[0]).toBe('2026-08-01T00:00:00+02:00');
  });

  it('refuses a non-GET method', async () => {
    const res = await call({ from: '2026-08-01', to: '2026-08-31' }, 'POST');
    expect(res.status).toBe(405);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe('honesty of the response', () => {
  it('reports excluded trips alongside the totals rather than hiding them', async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => (
      String(sql).includes('coverage')
        ? { active_vehicles: '23', tracked_vehicles: '18' }
        : {
            total: '10', eligible: '7', timed_out: '2', still_open: '1',
            distance_km: '123.45', moving_seconds: '3600', idle_seconds: '1800',
            unattributed_seconds: '5400',
          }
    ));

    const res = await call({ from: '2026-08-01', to: '2026-08-31' });

    expect(res.body.data.summary.tripsTotal).toBe(10);
    expect(res.body.data.summary.tripsCounted).toBe(7);
    // The 3 trips missing from the totals are named, not silently absent.
    expect(res.body.data.summary.excluded).toEqual({ timedOut: 2, stillOpen: 1 });
    expect(res.body.data.summary.distanceKm).toBe(123.45);
    // The remainder must be reported, not left implicit. 5,400s here against 3,600s moving:
    // without this figure the caller reads 123 km on one hour of driving.
    expect(res.body.data.summary.unattributedSeconds).toBe(5400);
  });

  it('reports tracker coverage so a partial answer does not read as complete', async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => (
      String(sql).includes('coverage')
        ? { active_vehicles: '23', tracked_vehicles: '18' }
        : { total: '0', eligible: '0', timed_out: '0', still_open: '0',
            distance_km: '0', moving_seconds: '0', idle_seconds: '0', unattributed_seconds: '0' }
    ));

    const res = await call({ from: '2026-08-01', to: '2026-08-31' });
    expect(res.body.data.coverage).toEqual({ activeVehicles: 23, trackedVehicles: 18 });
  });

  it('flags truncation when the row cap is reached', async () => {
    mocks.query.mockResolvedValue(Array.from({ length: 500 }, () => ({
      id: 'x', registration: 'AB12CD', ignition_on_at: '2026-08-01T06:00:00.000Z',
      ignition_off_at: '2026-08-01T07:00:00.000Z', close_reason: 'ignition_off',
      counts_toward_metrics: true, on_lat: null, on_lon: null, off_lat: null, off_lon: null,
      on_location_text: null, off_location_text: null,
      on_nearest_place_label: null, off_nearest_place_label: null,
      duration_seconds: '3600', moving_seconds: '3000', idle_seconds: '600',
      unattributed_seconds: '0',
      distance_km: '10.5', max_speed_kph: '95',
    })));

    const res = await call({ from: '2026-08-01', to: '2026-08-31' });
    expect(res.body.data.truncated).toBe(true);
  });

  it('converts numeric strings from the driver into numbers', async () => {
    mocks.query.mockResolvedValue([{
      id: 'x', registration: 'AB12CD', ignition_on_at: '2026-08-01T06:00:00.000Z',
      ignition_off_at: '2026-08-01T07:00:00.000Z', close_reason: 'ignition_off',
      counts_toward_metrics: true,
      on_lat: '-26.2000000', on_lon: '28.0000000', off_lat: null, off_lon: null,
      on_location_text: 'Centurion', off_location_text: null,
      on_nearest_place_label: 'Depot', off_nearest_place_label: null,
      duration_seconds: '3600', moving_seconds: '3000', idle_seconds: '600',
      unattributed_seconds: '0',
      distance_km: '10.5', max_speed_kph: '95',
    }]);

    const res = await call({ from: '2026-08-01', to: '2026-08-31' });
    const trip = res.body.data.trips[0];
    // node-postgres returns NUMERIC as a string; a string here would break every arithmetic
    // consumer downstream while still rendering fine in a table.
    expect(trip.distanceKm).toBe(10.5);
    expect(trip.start.lat).toBe(-26.2);
    expect(typeof trip.durationSeconds).toBe('number');
    expect(trip.start.place).toBe('Depot');
    expect(trip.start.locality).toBe('Centurion');
  });
});

describe('access control', () => {
  it('is gated on a permission, not merely on being logged in', () => {
    // A pass-through mock proves nothing about the gate, so this asserts against the SOURCE.
    // Bare withAuth would let any authenticated user of any role pull every vehicle's movement
    // history — a heavier disclosure than the live-position endpoint, which is gated.
    const src = readFileSync(
      resolve(__dirname, '../trips.ts'),
      'utf8',
    );
    expect(src).toContain("withPermission('fleet.locations', 'view')");
    expect(src).toContain('export default withAuth(');
  });
});
