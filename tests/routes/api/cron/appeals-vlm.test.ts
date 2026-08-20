vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
// The handler is now thin wiring: it resolves the auto-decide flag, selects the
// batch, and delegates each appeal to processAppeal (unit-tested in the runner
// suite). Mock that surface here and assert the wiring/lock/response shape only.
vi.mock('@/modules/sitecam/services/appealsVlmStore', () => ({
  findPendingAppeals: vi.fn(),
  isAutoDecideEnabled: vi.fn(),
}));
vi.mock('@/modules/sitecam/services/appealsVlmRunner', () => ({
  processAppeal: vi.fn(),
}));
// A dedicated pooled client holds the run-serialising advisory lock.
const dbClient = { query: vi.fn(), release: vi.fn() };
const mockConnect = vi.fn(() => Promise.resolve(dbClient));
// `connect` forwards to mockConnect lazily so tests can override it (e.g. reject to
// simulate a connect failure); a direct reference would hit the vi.mock-hoist TDZ.
vi.mock('@/lib/db', () => ({ default: { connect: () => mockConnect() } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/cron/appeals-vlm';
import { findPendingAppeals, isAutoDecideEnabled } from '@/modules/sitecam/services/appealsVlmStore';
import { processAppeal } from '@/modules/sitecam/services/appealsVlmRunner';

const mockFind = vi.mocked(findPendingAppeals);
const mockAutoDecideEnabled = vi.mocked(isAutoDecideEnabled);
const mockProcess = vi.mocked(processAppeal);

const SECRET = 'test-cron-secret';
const AUTH = { authorization: `Bearer ${SECRET}` };

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

const pending = (id: string) => ({
  id, dr_number: 'DR001', step_number: 6, job_type: 'activations' as const,
  photo_url: 'data:image/jpeg;base64,AAAA', appeal_text: 'green cable visible',
  serial_scanned: null, serial_expected: null,
});

describe('POST /api/cron/appeals-vlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    mockFind.mockResolvedValue([]);
    mockAutoDecideEnabled.mockResolvedValue(false);
    mockProcess.mockResolvedValue('scored');
    // Default: a healthy connection that acquires the advisory lock.
    mockConnect.mockImplementation(() => Promise.resolve(dbClient));
    dbClient.query.mockImplementation((sql: string) =>
      sql.includes('pg_try_advisory_lock')
        ? Promise.resolve({ rows: [{ locked: true }] })
        : Promise.resolve({ rows: [] }),
    );
  });

  it('rejects non-GET/POST with 405', async () => {
    expect((await run(AUTH, 'PUT'))._getStatusCode()).toBe(405);
  });
  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    expect((await run(AUTH))._getStatusCode()).toBe(500);
  });
  it('returns 401 on a missing bearer', async () => {
    expect((await run({}))._getStatusCode()).toBe(401);
  });
  it('returns 401 on a wrong bearer', async () => {
    expect((await run({ authorization: 'Bearer nope' }))._getStatusCode()).toBe(401);
  });

  it('processed:0 (and does not call processAppeal) when nothing is pending', async () => {
    const res = await run(AUTH);
    expect(mockProcess).not.toHaveBeenCalled();
    expect(res._getJSONData().data).toMatchObject({ processed: 0, scored: 0, autoDecided: 0, retried: 0, skipped: false });
  });

  it('resolves the auto-decide flag once and passes it to every processAppeal call', async () => {
    mockAutoDecideEnabled.mockResolvedValue(true);
    mockFind.mockResolvedValue([pending('a1'), pending('a2')] as never);
    mockProcess.mockResolvedValue('auto_decided');
    await run(AUTH);
    expect(mockAutoDecideEnabled).toHaveBeenCalledOnce();
    expect(mockProcess).toHaveBeenCalledTimes(2);
    expect(mockProcess).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), true);
    expect(mockProcess).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }), true);
  });

  it('tallies each processAppeal outcome into the response counters', async () => {
    mockFind.mockResolvedValue([pending('a1'), pending('a2'), pending('a3'), pending('a4')] as never);
    mockProcess
      .mockResolvedValueOnce('auto_decided')
      .mockResolvedValueOnce('scored')
      .mockResolvedValueOnce('retried')
      .mockResolvedValueOnce('noop');
    const res = await run(AUTH);
    expect(res._getJSONData().data).toMatchObject({
      processed: 4, autoDecided: 1, scored: 1, retried: 1, skipped: false,
    });
  });

  it('isolates a thrown processAppeal error without aborting the rest of the batch', async () => {
    mockFind.mockResolvedValue([pending('a1'), pending('a2')] as never);
    mockProcess.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('scored');
    const res = await run(AUTH);
    expect(mockProcess).toHaveBeenCalledTimes(2);
    expect(res._getJSONData().data).toMatchObject({ processed: 2, scored: 1 });
  });

  it('skips the tick when another run holds the advisory lock (prevents double-processing)', async () => {
    dbClient.query.mockImplementation((sql: string) =>
      sql.includes('pg_try_advisory_lock')
        ? Promise.resolve({ rows: [{ locked: false }] })
        : Promise.resolve({ rows: [] }),
    );
    mockFind.mockResolvedValue([pending('a1')] as never); // work is available…
    const res = await run(AUTH);
    // …but the tick bails before selecting or scoring anything.
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockProcess).not.toHaveBeenCalled();
    expect(res._getJSONData().data).toMatchObject({ processed: 0, scored: 0, retried: 0, skipped: true });
  });

  it('releases the advisory lock and returns the connection (not destroyed) after a run', async () => {
    mockFind.mockResolvedValue([pending('a1')] as never);
    await run(AUTH);
    const unlocked = dbClient.query.mock.calls.some((c) => (c[0] as string).includes('pg_advisory_unlock'));
    expect(unlocked).toBe(true);
    expect(dbClient.release).toHaveBeenCalledTimes(1);
    expect(dbClient.release).not.toHaveBeenCalledWith(true); // returned to the pool, not destroyed
  });

  it('destroys the connection when unlocking fails (frees the otherwise-leaked lock)', async () => {
    dbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return Promise.resolve({ rows: [{ locked: true }] });
      if (sql.includes('pg_advisory_unlock')) return Promise.reject(new Error('connection lost'));
      return Promise.resolve({ rows: [] });
    });
    await run(AUTH); // clean body (0 pending), but the unlock throws
    expect(dbClient.release).toHaveBeenCalledWith(true);
  });

  it('still unlocks + releases when the run body throws', async () => {
    mockFind.mockRejectedValue(new Error('db down'));
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
    const unlocked = dbClient.query.mock.calls.some((c) => (c[0] as string).includes('pg_advisory_unlock'));
    expect(unlocked).toBe(true);
    expect(dbClient.release).toHaveBeenCalled();
  });

  it('returns a clean, logged 500 when acquiring a DB connection fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('pool exhausted'));
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
    expect(dbClient.release).not.toHaveBeenCalled(); // no client acquired → nothing to release
  });
});
