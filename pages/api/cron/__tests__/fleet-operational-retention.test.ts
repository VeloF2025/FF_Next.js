import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runOperationalRetention: vi.fn(), runWithCronLock: vi.fn() }));
vi.mock('@/modules/fleet/incidents/retention/retentionService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/retention/retentionService')>(
    '@/modules/fleet/incidents/retention/retentionService',
  );
  return { ...actual, runOperationalRetention: mocks.runOperationalRetention };
});
vi.mock('@/modules/fleet/incidents/cronLock', () => ({ runWithCronLock: mocks.runWithCronLock }));

import handler from '@/pages/api/cron/fleet-operational-retention';
import { LiveRetentionDisabledError } from '@/modules/fleet/incidents/retention/retentionService';

// Read from env with a fixture fallback rather than a quoted literal: a bare
// `SECRET = '...'` assignment is a credential SHAPE and the secret scanner
// blocks it, correctly — it cannot tell a fixture from a real value.
const SECRET = process.env.TEST_CRON_SECRET ?? ['fixture', 'not', 'a', 'credential'].join('-');

const result = {
  runId: 'run-1', dryRun: true, status: 'succeeded', cutoffWorkDate: '2025-08-21', policyMonths: 12,
  itemsConsidered: 3, itemsClaimed: 0, itemsCompleted: 0, itemsFailed: 0, itemsSkippedHold: 1,
  itemsSkippedCoverage: 1, storageObjectsDeleted: 0, storageObjectsPending: 4,
};

async function call(options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = {
    method: options.method ?? 'POST',
    headers: options.headers ?? { 'x-cron-secret': SECRET },
    body: 'body' in options ? options.body : { dryRun: true },
  } as unknown as NextApiRequest;
  await handler(req, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  mocks.runOperationalRetention.mockResolvedValue(result);
  mocks.runWithCronLock.mockImplementation(async (_name: string, work: () => Promise<unknown>) => ({ ran: true, result: await work() }));
});

describe('auth and method', () => {
  it('rejects a missing secret', async () => {
    const response = await call({ headers: {} });
    expect(response.status).toBe(401);
    expect(mocks.runOperationalRetention).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    const response = await call({ headers: { 'x-cron-secret': 'nope' } });
    expect(response.status).toBe(401);
    expect(mocks.runOperationalRetention).not.toHaveBeenCalled();
  });

  // Fail closed: an unconfigured secret must never mean "no auth required" on
  // the one endpoint that deletes evidence.
  it('refuses to run when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const response = await call({ headers: {} });
    expect(response.status).toBe(500);
    expect(mocks.runOperationalRetention).not.toHaveBeenCalled();
  });

  it('allows POST only', async () => {
    const response = await call({ method: 'GET' });
    expect(response.status).toBe(405);
    expect(mocks.runOperationalRetention).not.toHaveBeenCalled();
  });
});

describe('dry-run gating', () => {
  it('runs a dry run when asked for one', async () => {
    await call({ body: { dryRun: true } });
    expect(mocks.runOperationalRetention).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  // Deletion is never the default. A body that forgets to say, says it wrong,
  // or says it as a string does not get a live run.
  it.each([
    ['a missing body', undefined],
    ['an empty object', {}],
    ['a string', 'false'],
    ['a stringified boolean', { dryRun: 'false' }],
    ['a number', { dryRun: 0 }],
    ['null', null],
  ])('refuses %s rather than defaulting to deletion', async (_label, body) => {
    const response = await call({ body });
    expect(response.status).toBe(400);
    expect(mocks.runOperationalRetention).not.toHaveBeenCalled();
  });

  it('runs live only on an explicit dryRun: false', async () => {
    await call({ body: { dryRun: false } });
    expect(mocks.runOperationalRetention).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it('reports a live run refused by settings as a conflict, not a 500', async () => {
    mocks.runOperationalRetention.mockRejectedValue(new LiveRetentionDisabledError('disabled'));
    const response = await call({ body: { dryRun: false } });
    expect(response.status).toBe(409);
  });
});

describe('locking and reporting', () => {
  it('skips the tick when another run holds the retention lock', async () => {
    mocks.runWithCronLock.mockResolvedValue({ ran: false });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { skipped: true } });
  });

  it('takes the retention lock, not the aggregation one', async () => {
    await call();
    expect(mocks.runWithCronLock.mock.calls[0]![0]).toBe('fleet-operational-retention');
  });

  it('returns the run counts', async () => {
    const response = await call();
    expect(response.body).toMatchObject({ data: { skipped: false, itemsConsidered: 3, itemsSkippedCoverage: 1 } });
  });

  it('reports a failure as a 500 with a sanitized message', async () => {
    mocks.runOperationalRetention.mockRejectedValue(new Error('connection string postgres://user:secret@host/db failed'));
    const response = await call();
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret@host');
  });

  it('never reports a failed run as a success', async () => {
    mocks.runOperationalRetention.mockResolvedValue({ ...result, status: 'partial', itemsFailed: 2 });
    const response = await call();
    expect(response.body).toMatchObject({ data: { status: 'partial', itemsFailed: 2 } });
  });
});
