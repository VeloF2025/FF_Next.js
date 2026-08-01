/**
 * Integration test for migration 474 — metrics snapshot spine.
 *
 * Why this exists: `fibreflow_user` has no CREATE on schema `public`, so the DDL
 * cannot be executed against the shared dev+prod database from a workstation. Without
 * this test the migration would reach deploy having never been run anywhere — a
 * parse-by-eye only. This runs the real forward file, then the real rollback.
 *
 * It also pins the one property the writer *depends on and does not defend*:
 * `writeSnapshot` deliberately has no `ON CONFLICT` clause, because a duplicate
 * entity_id means the source's key is not unique and silently dropping the row would
 * bake an undercount into a day recorded as complete. That safety net is the unique
 * index created here. If someone ever relaxes it, the writer degrades from
 * "aborts loudly" to "undercounts silently" — so it is asserted, not assumed.
 *
 * Sibling of 471/472/473: requires TEST_DATABASE_URL and throws at module load
 * without one, so it is excluded from the unit vitest config (vitest.config.ts).
 *
 * SAFETY: everything happens in a scratch schema dropped unconditionally in
 * afterAll. The shipped SQL uses unqualified names, so `search_path` alone redirects
 * it — no rewriting, meaning the statements under test are byte-identical to the
 * ones that will run at deploy. A stub `schema_migrations` is created in the scratch
 * schema so the rollback can run verbatim, including its tracker deletion.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig474_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '474_metrics_snapshot_spine.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_474_metrics_snapshot_spine.sql'), 'utf8');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

/**
 * Run inside the scratch schema so the unqualified DDL lands there.
 *
 * `?? []` matters: for a MULTI-statement string (which both migration files are)
 * node-postgres resolves to an ARRAY of Result objects, so `.rows` is undefined.
 * Returning undefined there makes any `resolves.toBeDefined()` assertion fail even
 * though the SQL succeeded — a false negative that says nothing about the migration.
 */
async function scoped<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${SCHEMA}`);
    const r = await client.query(sql, params);
    return (r.rows ?? []) as T[];
  } finally {
    client.release();
  }
}

/** Table names currently present in the scratch schema. */
async function tableNames(): Promise<string[]> {
  const rows = await scoped<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    [SCHEMA]
  );
  return rows.map((r) => r.tablename);
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  // Stand-in for the tracker so the rollback's DELETE runs as shipped.
  await scoped(`CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 474 — forward', () => {
  it('executes without error and creates both tables', async () => {
    // The whole point: this is the first time this DDL has ever run anywhere.
    // Asserting the observable outcome rather than the resolved value, which for
    // a multi-statement query says nothing.
    await scoped(FORWARD);
    const names = await tableNames();
    expect(names).toContain('metric_snapshots');
    expect(names).toContain('snapshot_runs');
  });

  it('is re-runnable (every statement is IF NOT EXISTS)', async () => {
    await scoped(FORWARD);
    await scoped(FORWARD);
    const names = await tableNames();
    expect(names).toContain('metric_snapshots');
    expect(names).toContain('snapshot_runs');
  });

  it('gives metric_snapshots the column types the writer assumes', async () => {
    const rows = await scoped<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'metric_snapshots'`,
      [SCHEMA]
    );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.source_key?.data_type).toBe('text');
    expect(byName.as_of_date?.data_type).toBe('date');
    expect(byName.entity_id?.data_type).toBe('text');
    expect(byName.dims?.data_type).toBe('jsonb');
    expect(byName.measures?.data_type).toBe('jsonb');
    // The writer never supplies these; a NOT NULL without a default would break it.
    expect(byName.dims?.is_nullable).toBe('NO');
    expect(byName.measures?.is_nullable).toBe('NO');
  });

  it('REJECTS a duplicate (source_key, as_of_date, entity_id)', async () => {
    // This index is the writer's only protection against a source with a
    // non-unique key. writeSnapshot has no ON CONFLICT precisely so this raises.
    await scoped(
      `INSERT INTO metric_snapshots (source_key, as_of_date, entity_id) VALUES ('s','2026-08-01','E1')`
    );
    await expect(
      scoped(
        `INSERT INTO metric_snapshots (source_key, as_of_date, entity_id) VALUES ('s','2026-08-01','E1')`
      )
    ).rejects.toThrow(/duplicate key value/i);
  });

  it('allows the same entity on a different day (the snapshot is per-day)', async () => {
    await expect(
      scoped(
        `INSERT INTO metric_snapshots (source_key, as_of_date, entity_id) VALUES ('s','2026-08-02','E1')`
      )
    ).resolves.toBeDefined();
  });

  it('REJECTS a second completion row for the same (source, day)', async () => {
    await scoped(`INSERT INTO snapshot_runs (source_key, as_of_date, row_count) VALUES ('s','2026-08-01',5)`);
    await expect(
      scoped(`INSERT INTO snapshot_runs (source_key, as_of_date, row_count) VALUES ('s','2026-08-01',9)`)
    ).rejects.toThrow(/duplicate key value/i);
  });

  it('requires row_count on a completion row — a run cannot be recorded without a count', async () => {
    await expect(
      scoped(`INSERT INTO snapshot_runs (source_key, as_of_date) VALUES ('s','2026-08-09')`)
    ).rejects.toThrow(/null value|not-null/i);
  });
});

describe('migration 474 — rollback', () => {
  it('removes both tables and clears its own tracker row', async () => {
    await scoped(
      `INSERT INTO schema_migrations (filename) VALUES ('474_metrics_snapshot_spine.sql')
       ON CONFLICT DO NOTHING`
    );
    await scoped(ROLLBACK);

    const names = await tableNames();
    expect(names).not.toContain('metric_snapshots');
    expect(names).not.toContain('snapshot_runs');

    const tracker = await scoped(
      `SELECT 1 FROM schema_migrations WHERE filename = '474_metrics_snapshot_spine.sql'`
    );
    expect(tracker).toHaveLength(0);
  });

  it('is re-runnable against an already-rolled-back schema', async () => {
    // Must not throw on absent tables/indexes — every statement is guarded.
    await scoped(ROLLBACK);
    await scoped(ROLLBACK);
    const names = await tableNames();
    expect(names).not.toContain('metric_snapshots');
  });
});
