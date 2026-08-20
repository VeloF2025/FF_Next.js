import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

const dbClient = { query: vi.fn(), release: vi.fn() };
const mockConnect = vi.fn(() => Promise.resolve(dbClient));
// `connect` forwards to mockConnect lazily so tests can override it (e.g. reject to
// simulate a connect failure); a direct reference would hit the vi.mock-hoist TDZ.
vi.mock('@/lib/db', () => ({ default: { connect: () => mockConnect() } }));

import { runWithCronLock } from '../cronLock';

const LOCK_NAME = 'fleet-operational-monitor';

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockImplementation(() => Promise.resolve(dbClient));
  dbClient.query.mockImplementation((sql: string) =>
    sql.includes('pg_try_advisory_lock')
      ? Promise.resolve({ rows: [{ locked: true }] })
      : Promise.resolve({ rows: [] }),
  );
});

describe('runWithCronLock', () => {
  it('acquires the lock, runs work on the pinned client, and returns its result', async () => {
    const work = vi.fn().mockResolvedValue({ processed: 3 });

    const outcome = await runWithCronLock(LOCK_NAME, work);

    expect(outcome).toEqual({ ran: true, result: { processed: 3 } });
    expect(work).toHaveBeenCalledWith(dbClient);
    const lockCall = dbClient.query.mock.calls.find((c) => (c[0] as string).includes('pg_try_advisory_lock'));
    expect(lockCall?.[1]).toEqual([LOCK_NAME]);
  });

  it('skips without running work when another run holds the lock', async () => {
    dbClient.query.mockImplementation((sql: string) =>
      sql.includes('pg_try_advisory_lock')
        ? Promise.resolve({ rows: [{ locked: false }] })
        : Promise.resolve({ rows: [] }),
    );
    const work = vi.fn();

    const outcome = await runWithCronLock(LOCK_NAME, work);

    expect(outcome).toEqual({ ran: false });
    expect(work).not.toHaveBeenCalled();
  });

  it('releases (not destroys) the connection after a clean run', async () => {
    await runWithCronLock(LOCK_NAME, async () => 'ok');

    const unlocked = dbClient.query.mock.calls.some((c) => (c[0] as string).includes('pg_advisory_unlock'));
    expect(unlocked).toBe(true);
    expect(dbClient.release).toHaveBeenCalledTimes(1);
    expect(dbClient.release).not.toHaveBeenCalledWith(true);
  });

  it('releases the connection without destroying it when the lock was never acquired', async () => {
    dbClient.query.mockImplementation((sql: string) =>
      sql.includes('pg_try_advisory_lock')
        ? Promise.resolve({ rows: [{ locked: false }] })
        : Promise.resolve({ rows: [] }),
    );
    await runWithCronLock(LOCK_NAME, vi.fn());

    expect(dbClient.release).toHaveBeenCalledTimes(1);
    expect(dbClient.release).not.toHaveBeenCalledWith(true);
  });

  it('destroys the connection (release(true)) when unlocking fails', async () => {
    dbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return Promise.resolve({ rows: [{ locked: true }] });
      if (sql.includes('pg_advisory_unlock')) return Promise.reject(new Error('connection lost'));
      return Promise.resolve({ rows: [] });
    });

    await runWithCronLock(LOCK_NAME, async () => 'ok');

    expect(dbClient.release).toHaveBeenCalledWith(true);
  });

  it('still unlocks and releases when the work function throws, and propagates the error', async () => {
    const work = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(runWithCronLock(LOCK_NAME, work)).rejects.toThrow('boom');

    const unlocked = dbClient.query.mock.calls.some((c) => (c[0] as string).includes('pg_advisory_unlock'));
    expect(unlocked).toBe(true);
    expect(dbClient.release).toHaveBeenCalledTimes(1);
  });

  it('propagates a connect failure with nothing to release', async () => {
    mockConnect.mockRejectedValueOnce(new Error('pool exhausted'));

    await expect(runWithCronLock(LOCK_NAME, vi.fn())).rejects.toThrow('pool exhausted');
    expect(dbClient.release).not.toHaveBeenCalled();
  });
});
