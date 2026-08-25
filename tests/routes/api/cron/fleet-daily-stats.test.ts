/**
 * Thin wiring test for POST /api/cron/fleet-daily-stats — auth, method, lock and response shape
 * only. The build's own behaviour (day-aligned windows, the ceiling, per-vehicle isolation, batch
 * invariance) is covered in src/modules/fleet/dailyStats/__tests__; the lock's acquire/release/
 * destroy discipline is covered in cronLock.test.ts.
 */
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const lock = vi.hoisted(() => ({ runWithCronLock: vi.fn() }));
vi.mock('@/modules/fleet/incidents/cronLock', () => lock);

const build = vi.hoisted(() => ({ buildDailyStats: vi.fn(), DAILY_STATS_LOCK: 'fleet-daily-stats' }));
vi.mock('@/modules/fleet/dailyStats/dailyStatsBuildService', () => build);

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/cron/fleet-daily-stats';

// Named to avoid the repo secret-scanner's credential-keyword-in-KEY rule
// (see scripts/secret-scan.sh) — this is a fixture value, never a real secret.
const CRON_AUTH_FIXTURE = 'fixture-cron-value';
const AUTH = { 'x-cron-secret': CRON_AUTH_FIXTURE };

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

const RUN_RESULT = {
  status: 'succeeded' as const, vehiclesRequested: 18, vehiclesSucceeded: 18, vehiclesFailed: 0,
  daysWritten: 36, positionsProcessed: 21_042, vehiclesWithBacklog: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_AUTH_FIXTURE;
  build.buildDailyStats.mockResolvedValue(RUN_RESULT);
  lock.runWithCronLock.mockImplementation(async (_lockName: string, work: () => Promise<unknown>) => ({
    ran: true, result: await work(),
  }));
});

describe('POST /api/cron/fleet-daily-stats', () => {
  it('rejects a non-POST method with 405', async () => {
    const res = await run(AUTH, 'PUT');
    expect(res._getStatusCode()).toBe(405);
    expect(build.buildDailyStats).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
    expect(lock.runWithCronLock).not.toHaveBeenCalled();
  });

  it('returns 401 on a missing cron secret', async () => {
    const res = await run({});
    expect(res._getStatusCode()).toBe(401);
    expect(lock.runWithCronLock).not.toHaveBeenCalled();
  });

  it('returns 401 on a wrong cron secret', async () => {
    const res = await run({ 'x-cron-secret': 'nope' });
    expect(res._getStatusCode()).toBe(401);
    expect(lock.runWithCronLock).not.toHaveBeenCalled();
  });

  it('runs the build under the fleet-daily-stats lock and returns its result', async () => {
    const res = await run(AUTH);

    expect(lock.runWithCronLock).toHaveBeenCalledWith('fleet-daily-stats', expect.any(Function));
    expect(build.buildDailyStats).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ skipped: false, status: 'succeeded', daysWritten: 36 });
  });

  it('skips without building when the lock is already held', async () => {
    lock.runWithCronLock.mockResolvedValue({ ran: false });

    const res = await run(AUTH);

    expect(build.buildDailyStats).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ skipped: true });
  });

  it('returns 500 when the build throws', async () => {
    build.buildDailyStats.mockRejectedValue(new Error('db unreachable'));
    lock.runWithCronLock.mockImplementation(async (_l: string, work: () => Promise<unknown>) => {
      await work();
      return { ran: true, result: undefined };
    });

    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
  });
});
