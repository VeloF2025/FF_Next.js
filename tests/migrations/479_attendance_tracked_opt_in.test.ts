/**
 * Integration test for migration 479 — staff.attendance_tracked opt-in.
 *
 * Executes the real forward and rollback SQL against an ephemeral Postgres in
 * a scratch schema (see tests/migrations/setup/global-setup.ts), so the files
 * themselves are exercised rather than whatever shape a live database happens
 * to be in.
 *
 * The behaviour that matters: the backfill must mark every staff member who
 * has ever clocked in. A real clocker left untracked silently stops being
 * expected, so their absences stop being raised at all.
 *
 * Requires TEST_DATABASE_URL env var (see .env.local.example).
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
    'See .env.local.example.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig479_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD_FILE = '479_attendance_tracked_opt_in.sql';
const FORWARD = readFileSync(join(SQL_DIR, FORWARD_FILE), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_479_attendance_tracked_opt_in.sql'),
  'utf8',
);

const CLOCKER = '00000000-0000-0000-0000-0000000000c1';
const NEVER_CLOCKED = '00000000-0000-0000-0000-0000000000a1';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

async function scoped<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
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

async function trackedFor(staffId: string): Promise<boolean | null> {
  const rows = await scoped<{ attendance_tracked: boolean }>(
    `SELECT attendance_tracked FROM staff WHERE id = $1`,
    [staffId],
  );
  return rows[0]?.attendance_tracked ?? null;
}

async function hasColumn(): Promise<boolean> {
  const rows = await scoped<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM pg_attribute
    WHERE attrelid = to_regclass('${SCHEMA}.staff')
      AND attname = 'attendance_tracked' AND NOT attisdropped`);
  return Number(rows[0]!.n) === 1;
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
});

beforeEach(async () => {
  // Rebuild each time so idempotency and rollback are tested from a known
  // starting point rather than whatever the previous case left behind.
  await scoped(`DROP TABLE IF EXISTS attendance_entries`);
  await scoped(`DROP TABLE IF EXISTS staff`);
  await scoped(`DROP TABLE IF EXISTS schema_migrations`);
  await scoped(`CREATE TABLE staff (id uuid PRIMARY KEY, name text)`);
  await scoped(`
    CREATE TABLE attendance_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid REFERENCES staff(id)
    )`);
  await scoped(
    `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`,
  );
  await scoped(`INSERT INTO staff (id, name) VALUES ($1, 'Clocker'), ($2, 'Office')`, [
    CLOCKER, NEVER_CLOCKED,
  ]);
  // Only CLOCKER has ever clocked in.
  await scoped(`INSERT INTO attendance_entries (staff_id) VALUES ($1), ($1)`, [CLOCKER]);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 479 — staff.attendance_tracked opt-in', () => {
  it('adds attendance_tracked as NOT NULL boolean defaulting to false', async () => {
    await scoped(FORWARD);

    const rows = await scoped<{
      data_type: string; is_nullable: string; column_default: string | null;
    }>(`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'staff'
        AND column_name = 'attendance_tracked'`);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.data_type).toBe('boolean');
    expect(rows[0]!.is_nullable).toBe('NO');
    expect(rows[0]!.column_default).toBe('false');
  });

  it('backfills staff who have ever clocked in and leaves the rest untracked', async () => {
    await scoped(FORWARD);

    expect(await trackedFor(CLOCKER)).toBe(true);
    expect(await trackedFor(NEVER_CLOCKED)).toBe(false);
  });

  it('re-running does not resurrect a flag HR has since turned off', async () => {
    await scoped(FORWARD);
    // HR decides this clocker is no longer under attendance control.
    await scoped(`UPDATE staff SET attendance_tracked = false WHERE id = $1`, [CLOCKER]);

    await scoped(FORWARD);

    expect(await trackedFor(CLOCKER)).toBe(false);
  });

  it('new staff inserted after the migration default to untracked', async () => {
    await scoped(FORWARD);
    const newHire = '00000000-0000-0000-0000-0000000000ff';
    await scoped(`INSERT INTO staff (id, name) VALUES ($1, 'New hire')`, [newHire]);

    expect(await trackedFor(newHire)).toBe(false);
  });

  it('rollback drops the column and clears its own schema_migrations row', async () => {
    await scoped(FORWARD);
    await scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);
    expect(await hasColumn()).toBe(true);

    await scoped(ROLLBACK);

    expect(await hasColumn()).toBe(false);
    const rows = await scoped<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM schema_migrations WHERE filename = $1`,
      [FORWARD_FILE],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('rollback is re-runnable', async () => {
    await scoped(FORWARD);
    await scoped(ROLLBACK);

    await expect(scoped(ROLLBACK)).resolves.toBeDefined();
    expect(await hasColumn()).toBe(false);
  });
});
