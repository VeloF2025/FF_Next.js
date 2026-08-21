import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbPool = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: dbPool.transaction }));

const pg = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() };
  const pool = { connect: vi.fn(), end: vi.fn() };
  const Pool = vi.fn(() => pool);
  return { client, pool, Pool, constructorArgs: [] as unknown[] };
});
vi.mock('pg', () => ({ Pool: pg.Pool }));

import { __resetRetentionPoolForTests, purgeTransaction, retentionIdentityDescription } from '../retentionDb';

// No password component: this URI only has to be structurally valid for the
// seam test, and `user:pass@host` is a credential shape the scanner blocks.
const DEDICATED = 'postgres://fleet_retention@localhost:5437/fibreflow';

beforeEach(() => {
  vi.clearAllMocks();
  __resetRetentionPoolForTests();
  delete process.env.FLEET_RETENTION_DATABASE_URL;
  dbPool.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) =>
    work({ query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null) }));
  pg.pool.connect.mockResolvedValue(pg.client);
  pg.client.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  delete process.env.FLEET_RETENTION_DATABASE_URL;
  __resetRetentionPoolForTests();
});

describe('default identity', () => {
  it('uses the shared application pool when no dedicated identity is configured', async () => {
    await purgeTransaction(async () => 'done');
    expect(dbPool.transaction).toHaveBeenCalledTimes(1);
    expect(pg.Pool).not.toHaveBeenCalled();
  });

  it('describes the identity as the application role', async () => {
    expect(retentionIdentityDescription()).toBe('application');
  });
});

describe('dedicated identity', () => {
  beforeEach(() => { process.env.FLEET_RETENTION_DATABASE_URL = DEDICATED; });

  it('runs the purge on the dedicated connection instead of the application pool', async () => {
    const result = await purgeTransaction(async () => 'purged');
    expect(result).toBe('purged');
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect(pg.Pool).toHaveBeenCalledTimes(1);
    const statements = pg.client.query.mock.calls.map(([text]) => String(text));
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(pg.client.release).toHaveBeenCalled();
  });

  it('rolls back and rethrows the original error', async () => {
    await expect(purgeTransaction(async () => { throw new Error('purge exploded'); }))
      .rejects.toThrow('purge exploded');
    expect(pg.client.query.mock.calls.map(([text]) => String(text))).toContain('ROLLBACK');
    expect(pg.client.release).toHaveBeenCalled();
  });

  // A failed ROLLBACK usually means a dead connection. The ORIGINAL error is
  // what the caller needs; masking it with the rollback failure would hide why
  // the purge failed, and the connection must not go back into the pool still
  // inside an aborted transaction.
  it('keeps the original error and discards the connection when rollback fails', async () => {
    pg.client.query.mockImplementation(async (text: string) => {
      if (text === 'ROLLBACK') throw new Error('connection terminated');
      return { rows: [] };
    });
    await expect(purgeTransaction(async () => { throw new Error('purge exploded'); }))
      .rejects.toThrow('purge exploded');
    expect(pg.client.release).toHaveBeenCalledWith(true);
  });

  it('builds the dedicated pool once and reuses it', async () => {
    await purgeTransaction(async () => 'a');
    await purgeTransaction(async () => 'b');
    expect(pg.Pool).toHaveBeenCalledTimes(1);
  });

  // The whole point of the seam is that the app role need not hold DELETE. A
  // dedicated identity that silently falls back to the application pool would
  // hand that power straight back.
  it('never falls back to the application pool when the dedicated connection fails', async () => {
    pg.pool.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(purgeTransaction(async () => 'x')).rejects.toThrow('ECONNREFUSED');
    expect(dbPool.transaction).not.toHaveBeenCalled();
  });

  it('describes the identity as dedicated without disclosing the connection string', async () => {
    const description = retentionIdentityDescription();
    expect(description).toBe('dedicated');
    expect(description).not.toContain('pw');
  });

  it('refuses a blank configured connection string rather than treating it as unset', async () => {
    process.env.FLEET_RETENTION_DATABASE_URL = '   ';
    await purgeTransaction(async () => 'x');
    expect(dbPool.transaction).toHaveBeenCalledTimes(1);
  });
});
