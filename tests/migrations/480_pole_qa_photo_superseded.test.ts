/**
 * Integration test for migration 480 — superseded marks on pole_qa_photos.
 *
 * SCOPE: the migration's own contract only. The BEHAVIOUR that sets and clears these
 * marks (import_replan_poles.py / replan_write.py) is covered by
 * scripts/test_replan_import_db.py, which applies this same file and then calls the
 * real functions. Asserting the behaviour here in hand-written SQL would prove only
 * that UPDATE works.
 *
 * What matters about this migration is that it is ADDITIVE and REVERSIBLE:
 *   1. It adds three nullable columns and touches no existing row. A replan marks
 *      photos it cannot place; if the migration defaulted or backfilled anything, live
 *      QA would appear superseded the moment it was applied.
 *   2. Re-applying is a no-op, including over rows that already carry marks — the
 *      deploy runner can re-run a migration after a partial failure.
 *   3. The rollback removes the columns and clears its own schema_migrations row, and
 *      is itself re-runnable.
 *
 * SAFETY: everything is created in a scratch schema dropped in afterAll.
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

const SCHEMA = 'mig480_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');

/** Same narrow rewrite as the 479 test — the shipped file is public-qualified on purpose. */
const scopeSql = (s: string) => s.replace(/\bpublic\./g, `${SCHEMA}.`);
const FORWARD = scopeSql(readFileSync(join(SQL_DIR, '480_pole_qa_photo_superseded.sql'), 'utf8'));
const ROLLBACK = scopeSql(
  readFileSync(join(SQL_DIR, 'rollback_480_pole_qa_photo_superseded.sql'), 'utf8')
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

async function scoped<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const r = await client.query(sql, params);
    return (r.rows ?? []) as T[];
  } finally {
    client.release();
  }
}

const COLUMNS = ['superseded_at', 'superseded_reason', 'superseded_run_id'];

async function presentColumns(): Promise<string[]> {
  const rows = await scoped<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'pole_qa_photos'
        AND column_name = ANY($2) ORDER BY column_name`,
    [SCHEMA, COLUMNS]
  );
  return rows.map((r) => r.column_name);
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(
    `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`
  );
  await scoped(`CREATE TABLE pole_qa_photos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid, pole_label text, zone_no integer, pon_no integer,
      UNIQUE (project_id, pole_label))`);
  await scoped(
    `INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
     VALUES (gen_random_uuid(), 'TEM.P.J950', 69, 821)`
  );
  await scoped(FORWARD);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 480 — additive and reversible', () => {
  it('adds all three columns', async () => {
    expect(await presentColumns()).toEqual(COLUMNS);
  });

  it('leaves existing rows untouched — nothing is marked on apply', async () => {
    const [row] = await scoped<{
      pole_label: string;
      zone_no: number;
      superseded_at: Date | null;
      superseded_run_id: string | null;
      superseded_reason: string | null;
    }>(`SELECT pole_label, zone_no, superseded_at, superseded_run_id, superseded_reason
        FROM pole_qa_photos`);
    // A backfill or a DEFAULT here would make live QA look superseded on deploy.
    expect(row).toMatchObject({ pole_label: 'TEM.P.J950', zone_no: 69 });
    expect(row!.superseded_at).toBeNull();
    expect(row!.superseded_run_id).toBeNull();
    expect(row!.superseded_reason).toBeNull();
  });

  it('creates the partial index used to find marked photos', async () => {
    const rows = await scoped<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = $1 AND indexname = 'pole_qa_photos_superseded_idx'`,
      [SCHEMA]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE \(superseded_at IS NOT NULL\)/);
  });

  it('is idempotent — re-applying preserves marks already set', async () => {
    const runId = '44444444-4444-4444-4444-444444444444';
    await scoped(
      `UPDATE pole_qa_photos SET superseded_at = now(), superseded_run_id = $1,
              superseded_reason = 'unplaceable'`,
      [runId]
    );
    await scoped(FORWARD);
    const [row] = await scoped<{ superseded_run_id: string; superseded_reason: string }>(
      `SELECT superseded_run_id, superseded_reason FROM pole_qa_photos`
    );
    expect(row).toEqual({ superseded_run_id: runId, superseded_reason: 'unplaceable' });
    await scoped(`UPDATE pole_qa_photos SET superseded_at = NULL, superseded_run_id = NULL,
                         superseded_reason = NULL`);
  });

  it('rollback drops the columns, keeps the photos, and clears its tracker row', async () => {
    await scoped(
      `INSERT INTO schema_migrations (filename) VALUES ('480_pole_qa_photo_superseded.sql')`
    );
    await scoped(ROLLBACK);

    expect(await presentColumns()).toEqual([]);
    // The marks go; the QA rows they described do not.
    const [{ n }] = await scoped<{ n: string }>(
      `SELECT count(*)::text AS n FROM pole_qa_photos WHERE pole_label = 'TEM.P.J950'`
    );
    expect(n).toBe('1');
    const tracked = await scoped(
      `SELECT filename FROM schema_migrations WHERE filename = '480_pole_qa_photo_superseded.sql'`
    );
    expect(tracked).toEqual([]);

    // Re-runnable: a second rollback on an already-rolled-back schema must not throw.
    await expect(scoped(ROLLBACK)).resolves.toBeDefined();

    await scoped(FORWARD); // leave the schema as the other cases found it
  });
});
