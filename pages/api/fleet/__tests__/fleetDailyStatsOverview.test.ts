/**
 * GET /api/fleet/daily-stats/overview — the default day, and the silent vehicle.
 *
 * The default is YESTERDAY in SAST. Today's fold has only seen the hours that have happened, so
 * defaulting to today makes the whole fleet read as partially covered every morning; and reading
 * "yesterday" off a UTC clock is the wrong day for two hours out of every 24.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '@/pages/api/fleet/daily-stats/overview';

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

const stats = {
  work_date: '2026-08-24', ignition_seconds: '3600', moving_seconds: '3000', idle_seconds: '600',
  unattributed_seconds: '0', distance_km: '42.75', max_speed_kph: '118.40', speeding_events: '1',
  speeding_seconds: '120', harsh_brake_events: '0', harsh_accel_events: '0',
  harsh_corner_events: '0', first_ignition_at: null, last_ignition_at: null,
  position_count: '900', tracker_silence_seconds: '60', provider: 'cartrack',
  account_ref: 'velocity', coverage_granularity: 'history', coverage_ignition: true,
  coverage_gforce: false, coverage_provider_events: true, coverage_complete: true,
  source_watermark: '2026-08-24T21:00:00.000Z', computed_at: '2026-08-25T00:05:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.query.mockResolvedValue([]);
});

afterEach(() => { vi.useRealTimers(); });

describe('the default day', () => {
  it('is yesterday in SAST', async () => {
    vi.setSystemTime(new Date('2026-08-25T09:00:00.000Z'));
    const res = await call({});
    expect(res.body.data.workDate).toBe('2026-08-24');
    expect(mocks.query.mock.calls[0]![1]).toEqual(['2026-08-24']);
  });

  it('rolls over at SAST midnight, not UTC midnight', async () => {
    // 00:30 on the 26th in Johannesburg: yesterday is the 25th, not the 24th.
    vi.setSystemTime(new Date('2026-08-25T22:30:00.000Z'));
    const res = await call({});
    expect(res.body.data.workDate).toBe('2026-08-25');
  });

  it('honours an explicit date and rejects a malformed one', async () => {
    expect((await call({ date: '2026-08-01' })).body.data.workDate).toBe('2026-08-01');
    const bad = await call({ date: 'last tuesday' });
    expect(bad.status).toBe(400);
  });
});

describe('the silent vehicle survives', () => {
  it('reports a tracked vehicle with no row as null stats, and counts it', async () => {
    mocks.query.mockResolvedValue([
      { id: 'v1', registration: 'AAA', make: null, model: null, status: 'active',
        has_stats: false, ...stats, work_date: null },
      { id: 'v2', registration: 'BBB', make: null, model: null, status: 'active',
        has_stats: true, ...stats },
      { id: 'v3', registration: 'CCC', make: null, model: null, status: 'active',
        has_stats: true, ...stats, coverage_complete: false },
    ]);
    const res = await call({ date: '2026-08-24' });
    expect(res.body.data.vehicles[0].stats).toBeNull();
    expect(res.body.data.coverage).toEqual({
      trackedVehicles: 3, vehiclesWithData: 2, vehiclesPartial: 1,
    });
  });
});

describe('access control', () => {
  it('is gated on fleet.vehicle-stats', () => {
    const src = readFileSync(resolve(__dirname, '../daily-stats/overview.ts'), 'utf8');
    expect(src).toContain("withPermission('fleet.vehicle-stats', 'view')");
    expect(src).toContain('export default withAuth(');
  });

  it('refuses a non-GET method', async () => {
    expect((await call({}, 'DELETE')).status).toBe(405);
  });
});
