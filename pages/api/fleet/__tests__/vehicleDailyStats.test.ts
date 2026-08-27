/**
 * GET /api/fleet/vehicles/[id]/daily-stats — the gate, the 404, the clamp, and the SAST window.
 *
 * The window is the reason this file exists. The process runs in UTC here, as CI does. A window
 * derived from the host's calendar (`new Date().getDate()`, `toISOString().slice(0, 10)`) is a day
 * out for every instant between 22:00 UTC and midnight, and the failure is invisible: the endpoint
 * returns a plausible 30 rows, just the wrong 30. So the tests assert the literal dates that reach
 * SQL, not merely that a query happened.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, queryOne: mocks.queryOne }));
// Pass-throughs so the handler is reachable. That the route IS wrapped is asserted against the
// SOURCE below — a pass-through mock can never prove a gate exists.
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '@/pages/api/fleet/vehicles/[id]/daily-stats';

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

function paramsFor(tag: string): unknown[] | undefined {
  return [...mocks.query.mock.calls, ...mocks.queryOne.mock.calls]
    .find(([sql]) => String(sql).includes(tag))?.[1] as unknown[] | undefined;
}

const statsRow = {
  work_date: '2026-08-20', ignition_seconds: '3600', moving_seconds: '3000', idle_seconds: '600',
  unattributed_seconds: '0', distance_km: '42.75', max_speed_kph: '118.40',
  speeding_events: '0', speeding_seconds: '0', harsh_brake_events: '0', harsh_accel_events: '0',
  harsh_corner_events: '0', first_ignition_at: null, last_ignition_at: null,
  position_count: '1169', tracker_silence_seconds: '480', provider: 'cartrack',
  account_ref: 'velocity', coverage_granularity: 'history', coverage_ignition: true,
  coverage_gforce: false, coverage_provider_events: true, coverage_complete: true,
  source_watermark: '2026-08-20T21:59:00.000Z', computed_at: '2026-08-21T00:05:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockImplementation(async (sql: string) => (
    String(sql).includes('first-position')
      ? { first_at: '2026-01-01T05:00:00.000Z' }
      : { id: VEHICLE, registration: 'AB12CD GP', make: 'Toyota', model: 'Hilux', status: 'active' }
  ));
});

afterEach(() => { vi.useRealTimers(); });

describe('the SAST 30-day window', () => {
  it('ends on YESTERDAY in SAST, which at 22:30 UTC is already today’s date', async () => {
    vi.setSystemTime(new Date('2026-08-25T22:30:00.000Z'));
    await call({ id: VEHICLE });
    // 00:30 on the 26th in Johannesburg, so yesterday is the 25th. A UTC clock says the 24th.
    expect(paramsFor('fleet-daily-stats:series')).toEqual([VEHICLE, '2026-07-27', '2026-08-25']);
  });

  it('spans 30 inclusive complete days by default', async () => {
    vi.setSystemTime(new Date('2026-08-25T09:00:00.000Z'));
    await call({ id: VEHICLE });
    expect(paramsFor('fleet-daily-stats:series')).toEqual([VEHICLE, '2026-07-26', '2026-08-24']);
  });

  it('honours an explicit endDate', async () => {
    await call({ id: VEHICLE, endDate: '2026-03-01', days: '2' });
    expect(paramsFor('fleet-daily-stats:series')).toEqual([VEHICLE, '2026-02-28', '2026-03-01']);
  });

  it('clamps an over-long range rather than serving it', async () => {
    await call({ id: VEHICLE, endDate: '2026-08-25', days: '5000' });
    const params = paramsFor('fleet-daily-stats:series');
    expect(params?.[1]).toBe('2026-05-28');
  });
});

describe('validation', () => {
  it.each([
    ['a non-UUID id', { id: 'not-a-uuid' }],
    ['a malformed endDate', { id: VEHICLE, endDate: 'yesterday' }],
    ['a non-numeric days', { id: VEHICLE, days: 'lots' }],
    ['a zero-day window', { id: VEHICLE, days: '0' }],
  ])('rejects %s', async (_label, q) => {
    const res = await call(q as Record<string, string>);
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('404s an unknown vehicle before reading any statistics', async () => {
    mocks.queryOne.mockResolvedValue(null);
    const res = await call({ id: VEHICLE });
    expect(res.status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('refuses a non-GET method', async () => {
    const res = await call({ id: VEHICLE }, 'POST');
    expect(res.status).toBe(405);
  });
});

describe('coverage is expected days, not elapsed days', () => {
  it('counts only from the vehicle’s first fix', async () => {
    vi.setSystemTime(new Date('2026-08-25T09:00:00.000Z'));
    // First seen on the 21st: the days before the tracker existed are not missing data. The
    // window ends on the 24th (yesterday), so 21–24 inclusive is four expected days.
    mocks.queryOne.mockImplementation(async (sql: string) => (
      String(sql).includes('first-position')
        ? { first_at: '2026-08-21T06:00:00.000Z' }
        : { id: VEHICLE, registration: 'AB12CD GP', make: null, model: null, status: 'active' }
    ));
    mocks.query.mockResolvedValue([statsRow]);
    const res = await call({ id: VEHICLE });
    expect(res.body.data.coverage.daysExpected).toBe(4);
    expect(res.body.data.coverage.daysWithData).toBe(1);
  });

  it('expects nothing from a vehicle that has never reported', async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => (
      String(sql).includes('first-position')
        ? { first_at: null }
        : { id: VEHICLE, registration: 'AB12CD GP', make: null, model: null, status: 'active' }
    ));
    const res = await call({ id: VEHICLE, endDate: '2026-08-25' });
    expect(res.body.data.coverage.daysExpected).toBe(0);
    expect(res.body.data.coverage.firstPositionWorkDate).toBeNull();
  });

  it('returns the days that exist and does not invent the rest', async () => {
    mocks.query.mockResolvedValue([statsRow]);
    const res = await call({ id: VEHICLE, endDate: '2026-08-25' });
    expect(res.body.data.days).toHaveLength(1);
    expect(res.body.data.days[0].workDate).toBe('2026-08-20');
  });
});

describe('today is separate from the window', () => {
  it('returns today on its own line and keeps it out of days and coverage', async () => {
    vi.setSystemTime(new Date('2026-08-25T09:00:00.000Z'));
    mocks.query.mockImplementation(async (_sql: string, params: unknown[]) => (
      // The one-day window over today.
      params[1] === '2026-08-25'
        ? [{ ...statsRow, work_date: '2026-08-25', coverage_complete: false }]
        : [statsRow]
    ));
    const res = await call({ id: VEHICLE });

    expect(res.body.data.today.workDate).toBe('2026-08-25');
    expect(res.body.data.today.stats.workDate).toBe('2026-08-25');
    // The whole point: a day still running is coverage_complete = false for reasons that say
    // nothing about the tracker, so counting it would leave a healthy vehicle amber every
    // morning until midnight.
    expect(res.body.data.days).toHaveLength(1);
    expect(res.body.data.days[0].workDate).toBe('2026-08-20');
    expect(res.body.data.coverage.daysWithData).toBe(1);
    expect(res.body.data.coverage.daysPartial).toBe(0);
  });

  it('returns a null today row when the fold has not produced one yet', async () => {
    vi.setSystemTime(new Date('2026-08-25T09:00:00.000Z'));
    mocks.query.mockResolvedValue([]);
    const res = await call({ id: VEHICLE });
    expect(res.body.data.today).toEqual({ workDate: '2026-08-25', stats: null });
  });

  it('has no in-progress line at all for a historical window', async () => {
    vi.setSystemTime(new Date('2026-08-25T09:00:00.000Z'));
    const res = await call({ id: VEHICLE, endDate: '2026-06-30' });
    expect(res.body.data.today).toBeNull();
    // And it did not go looking for one.
    const windows = mocks.query.mock.calls
      .filter(([sql]) => String(sql).includes('fleet-daily-stats:series'))
      .map(([, params]) => (params as string[])[2]);
    expect(windows).toEqual(['2026-06-30']);
  });
});

describe('the payload carries nothing it does not render', () => {
  it('drops daysIgnitionMeasurable and unattributed seconds', async () => {
    mocks.query.mockResolvedValue([statsRow]);
    const res = await call({ id: VEHICLE, endDate: '2026-08-25' });
    // Both were shipped in the first cut and rendered nowhere. A payload field with no reader is
    // a contract nobody honours — the measurable-day count is derived client-side from the rows
    // themselves, and unattributed seconds are 0 on exactly the feeds that would need them.
    expect(res.body.data.coverage).not.toHaveProperty('daysIgnitionMeasurable');
    expect(res.body.data.days[0]).not.toHaveProperty('unattributedSeconds');
    const seriesSql = String(mocks.query.mock.calls
      .find(([sql]) => String(sql).includes('fleet-daily-stats:series'))?.[0] ?? '');
    expect(seriesSql).not.toMatch(/unattributed_seconds/);
  });
});

describe('access control', () => {
  it('is gated on fleet.vehicle-stats, not merely on being logged in', () => {
    const src = readFileSync(resolve(__dirname, '../vehicles/[id]/daily-stats.ts'), 'utf8');
    expect(src).toContain("withPermission('fleet.vehicle-stats', 'view')");
    expect(src).toContain('export default withAuth(');
  });
});
