/**
 * Integration test for migration 482 — attendance adjustment clock ordering.
 *
 * Executes the real forward and rollback SQL against an ephemeral Postgres in
 * a scratch schema (see tests/migrations/setup/global-setup.ts), so the files
 * themselves are exercised rather than whatever shape a live database happens
 * to be in.
 *
 * The behaviour that matters: a correction that sets BOTH timestamps must not
 * be storable with clock-out at or before clock-in — that is the shape that
 * produced a -61.5h row — while one-sided corrections (forgot_clock_out, the
 * common case) must stay legal.
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

const SCHEMA = 'mig482_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD_FILE = '482_attendance_adjustment_time_order.sql';
const FORWARD = readFileSync(join(SQL_DIR, FORWARD_FILE), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_482_attendance_adjustment_time_order.sql'),
  'utf8',
);

const CONSTRAINT = 'attendance_adjustments_time_order';
const IN_AT = '2026-05-15 05:00:00+00';
const OUT_AT = '2026-05-15 15:30:00+00';

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

/** Insert an adjustment, returning the error code if the DB rejected it. */
async function tryInsert(
  clockIn: string | null,
  clockOut: string | null,
): Promise<{ ok: true } | { ok: false; code: string; constraint?: string }> {
  try {
    await scoped(
      `INSERT INTO attendance_adjustments (adjusted_clock_in_at, adjusted_clock_out_at)
       VALUES ($1::timestamptz, $2::timestamptz)`,
      [clockIn, clockOut],
    );
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    return { ok: false, code: e.code ?? 'unknown', constraint: e.constraint };
  }
}

async function hasConstraint(): Promise<boolean> {
  const rows = await scoped<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM pg_constraint
    WHERE conrelid = to_regclass('${SCHEMA}.attendance_adjustments')
      AND conname = '${CONSTRAINT}'`);
  return Number(rows[0]!.n) === 1;
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
});

beforeEach(async () => {
  // Rebuild each time so idempotency and rollback are tested from a known
  // starting point rather than whatever the previous case left behind.
  await scoped(`DROP TABLE IF EXISTS attendance_adjustments`);
  await scoped(`DROP TABLE IF EXISTS schema_migrations`);
  await scoped(`
    CREATE TABLE attendance_adjustments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      adjusted_clock_in_at timestamptz,
      adjusted_clock_out_at timestamptz
    )`);
  await scoped(
    `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`,
  );
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 482 — attendance adjustment clock ordering', () => {
  it('adds the ordering constraint', async () => {
    await scoped(FORWARD);
    expect(await hasConstraint()).toBe(true);
  });

  it('rejects the -61.5h shape that reached production', async () => {
    await scoped(FORWARD);

    // The real row: clock-in carried the 2026-05-18 submission date while
    // clock-out stayed on the 2026-05-15 work date.
    const result = await tryInsert('2026-05-18 05:00:00+00', OUT_AT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('23514'); // check_violation
    expect(result.constraint).toBe(CONSTRAINT);
  });

  it('rejects a zero-length shift', async () => {
    await scoped(FORWARD);
    const result = await tryInsert(IN_AT, IN_AT);
    expect(result.ok).toBe(false);
  });

  it('accepts a normally ordered shift', async () => {
    await scoped(FORWARD);
    expect((await tryInsert(IN_AT, OUT_AT)).ok).toBe(true);
  });

  it('accepts a shift ending after midnight the next day', async () => {
    await scoped(FORWARD);
    // A night shift legitimately ends on work_date + 1. The constraint is
    // ordering-only precisely so this stays storable.
    expect((await tryInsert('2026-05-15 21:00:00+00', '2026-05-16 05:00:00+00')).ok).toBe(true);
  });

  it('leaves one-sided corrections legal', async () => {
    await scoped(FORWARD);
    // forgot_clock_out — the common case — sets only the clock-out.
    expect((await tryInsert(null, OUT_AT)).ok).toBe(true);
    expect((await tryInsert(IN_AT, null)).ok).toBe(true);
    expect((await tryInsert(null, null)).ok).toBe(true);
  });

  it('rejects an UPDATE that inverts a previously valid row', async () => {
    // A CHECK constraint guards every write, not just INSERT. Without this
    // case the suite would still pass if the constraint were somehow
    // insert-only, and an approved correction could be inverted after review.
    await scoped(FORWARD);
    await scoped(
      `INSERT INTO attendance_adjustments (id, adjusted_clock_in_at, adjusted_clock_out_at)
       VALUES ('00000000-0000-0000-0000-0000000000e1', $1::timestamptz, $2::timestamptz)`,
      [IN_AT, OUT_AT],
    );

    let failed = false;
    try {
      await scoped(
        `UPDATE attendance_adjustments SET adjusted_clock_out_at = $1::timestamptz
         WHERE id = '00000000-0000-0000-0000-0000000000e1'`,
        ['2026-05-15 04:00:00+00'],
      );
    } catch (err) {
      failed = true;
      expect((err as { code?: string }).code).toBe('23514');
    }
    expect(failed).toBe(true);
  });

  it('preflight blocks the migration and names the offending row', async () => {
    // The deploy runner aborts on a failed migration, so the failure must say
    // which row to fix rather than emitting a bare 23514.
    const BAD_ID = '00000000-0000-0000-0000-0000000000b1';
    await scoped(
      `INSERT INTO attendance_adjustments (id, adjusted_clock_in_at, adjusted_clock_out_at)
       VALUES ($1, '2026-05-18 05:00:00+00'::timestamptz, $2::timestamptz)`,
      [BAD_ID, OUT_AT],
    );

    let message = '';
    try {
      await scoped(FORWARD);
    } catch (err) {
      message = (err as { message?: string }).message ?? '';
    }

    expect(message).toContain('Migration 482 preflight');
    expect(message).toContain(BAD_ID);
    // And it must not have half-applied.
    expect(await hasConstraint()).toBe(false);
  });

  it('applies cleanly once the offending row is corrected', async () => {
    const BAD_ID = '00000000-0000-0000-0000-0000000000b2';
    await scoped(
      `INSERT INTO attendance_adjustments (id, adjusted_clock_in_at, adjusted_clock_out_at)
       VALUES ($1, '2026-05-18 05:00:00+00'::timestamptz, $2::timestamptz)`,
      [BAD_ID, OUT_AT],
    );
    await expect(scoped(FORWARD)).rejects.toThrow();

    await scoped(
      `UPDATE attendance_adjustments SET adjusted_clock_in_at = $1::timestamptz WHERE id = $2`,
      [IN_AT, BAD_ID],
    );

    await expect(scoped(FORWARD)).resolves.toBeDefined();
    expect(await hasConstraint()).toBe(true);
  });

  it('does not reject rows that already exist when it is applied', async () => {
    // Ordering is enforced going forward; applying it must not fail on the
    // legitimate rows already in the table.
    await scoped(
      `INSERT INTO attendance_adjustments (adjusted_clock_in_at, adjusted_clock_out_at)
       VALUES ($1::timestamptz, $2::timestamptz), (NULL, $2::timestamptz)`,
      [IN_AT, OUT_AT],
    );

    await expect(scoped(FORWARD)).resolves.toBeDefined();
    expect(await hasConstraint()).toBe(true);
  });

  it('is re-runnable', async () => {
    await scoped(FORWARD);
    await scoped(FORWARD);
    expect(await hasConstraint()).toBe(true);
  });

  it('rollback drops the constraint and clears its own tracker row', async () => {
    await scoped(FORWARD);
    await scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);

    await scoped(ROLLBACK);

    expect(await hasConstraint()).toBe(false);
    const tracked = await scoped<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM schema_migrations WHERE filename = $1`,
      [FORWARD_FILE],
    );
    expect(Number(tracked[0]!.n)).toBe(0);
    // The bad shape is storable again — proving the constraint was what
    // rejected it, not some other guard.
    expect((await tryInsert('2026-05-18 05:00:00+00', OUT_AT)).ok).toBe(true);
  });

  it('rollback is re-runnable', async () => {
    await scoped(FORWARD);
    await scoped(ROLLBACK);
    await expect(scoped(ROLLBACK)).resolves.toBeDefined();
    expect(await hasConstraint()).toBe(false);
  });
});
