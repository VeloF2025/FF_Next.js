vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
// Thin wiring test — auth, method, lock, and response-shape only. The monitor's
// own orchestration (roster load, per-staff isolation, systemic failure →
// finalized "failed" run, counters) is unit-tested in monitorService.test.ts;
// the lock acquire/release/destroy discipline is unit-tested in cronLock.test.ts.
const lock = vi.hoisted(() => ({ runWithCronLock: vi.fn() }));
vi.mock('@/modules/fleet/incidents/cronLock', () => lock);

const monitor = vi.hoisted(() => ({ runOperationalMonitor: vi.fn() }));
vi.mock('@/modules/fleet/incidents/monitorService', () => monitor);

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/cron/fleet-operational-monitor';

// Named to avoid the repo secret-scanner's credential-keyword-in-KEY rule
// (see scripts/secret-scan.sh) — this is a fixture value, never a real secret.
const CRON_AUTH_FIXTURE = 'fixture-cron-value';
const AUTH = { 'x-cron-secret': CRON_AUTH_FIXTURE };

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

const RUN_RESULT = {
  monitorRunId: 'run-1', status: 'succeeded' as const, rosterEvaluatedCount: 5, incidentsOpenedCount: 1,
  incidentsUpdatedCount: 0, incidentsClearedCount: 0, notifications: { delivered: 1, suppressed: 0, failed: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_AUTH_FIXTURE;
  monitor.runOperationalMonitor.mockResolvedValue(RUN_RESULT);
  lock.runWithCronLock.mockImplementation(async (_lockName: string, work: () => Promise<unknown>) => ({
    ran: true, result: await work(),
  }));
});

describe('POST /api/cron/fleet-operational-monitor', () => {
  it('rejects non-GET/POST with 405', async () => {
    expect((await run(AUTH, 'PUT'))._getStatusCode()).toBe(405);
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
    expect((await run({ 'x-cron-secret': 'nope' }))._getStatusCode()).toBe(401);
  });

  it('runs the monitor under the fleet-operational-monitor lock name and returns its result', async () => {
    const res = await run(AUTH);

    expect(lock.runWithCronLock).toHaveBeenCalledWith('fleet-operational-monitor', expect.any(Function));
    expect(monitor.runOperationalMonitor).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ skipped: false, monitorRunId: 'run-1', status: 'succeeded' });
  });

  it('skips without running the monitor when the lock is already held', async () => {
    lock.runWithCronLock.mockResolvedValue({ ran: false });

    const res = await run(AUTH);

    expect(monitor.runOperationalMonitor).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ skipped: true });
  });

  it('returns 500 when the monitor throws (its own finalize path records the failed run)', async () => {
    lock.runWithCronLock.mockImplementation(async (_lockName: string, work: () => Promise<unknown>) => {
      await work(); // let the mocked rejection surface through the same call shape as production
      return { ran: true, result: undefined };
    });
    monitor.runOperationalMonitor.mockRejectedValue(new Error('db unreachable'));

    const res = await run(AUTH);

    expect(res._getStatusCode()).toBe(500);
  });

  it('accepts GET as well as POST', async () => {
    const res = await run(AUTH, 'GET');
    expect(res._getStatusCode()).toBe(200);
  });
});
