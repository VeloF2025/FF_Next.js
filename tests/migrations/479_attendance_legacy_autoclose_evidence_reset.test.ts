import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DATABASE_URL ? describe : describe.skip;
const SCHEMA = 'mig479_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/479_attendance_legacy_autoclose_evidence_reset.sql'),
  'utf8'
);
const ROLLBACK = readFileSync(
  join(
    process.cwd(),
    'scripts/migrations/sql/rollback_479_attendance_legacy_autoclose_evidence_reset.sql'
  ),
  'utf8'
);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: false,
  max: 2,
  connectionTimeoutMillis: 10_000,
});

async function scoped<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path = ${SCHEMA}, public`);
    return await client.query<T>(text, values);
  } finally {
    client.release();
  }
}

const prerequisites = `
  CREATE TABLE schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE attendance_entries (
    id UUID PRIMARY KEY,
    staff_id UUID NOT NULL,
    work_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL,
    clock_out_at TIMESTAMPTZ,
    received_at_out TIMESTAMPTZ,
    status VARCHAR NOT NULL,
    notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE attendance_daily_summaries (
    staff_id UUID NOT NULL,
    work_date DATE NOT NULL,
    regular_hrs NUMERIC NOT NULL DEFAULT 0.00,
    overtime_hrs NUMERIC NOT NULL DEFAULT 0.00,
    sunday_hrs NUMERIC NOT NULL DEFAULT 0.00,
    holiday_hrs NUMERIC NOT NULL DEFAULT 0.00,
    night_hrs NUMERIC NOT NULL DEFAULT 0.00,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (staff_id, work_date)
  );
  CREATE TABLE attendance_exceptions (
    id BIGSERIAL PRIMARY KEY,
    entry_id UUID NOT NULL,
    exception_kind TEXT NOT NULL
  );
  CREATE TABLE attendance_schedule_policies (
    id UUID PRIMARY KEY,
    active_from DATE NOT NULL,
    active_to DATE
  );
  INSERT INTO attendance_schedule_policies (id, active_from, active_to)
  VALUES ('30000000-0000-4000-8000-000000000001', DATE '2026-08-03', NULL);
`;

const STAFF = '10000000-0000-4000-8000-00000000000';
const FABRICATED = '20000000-0000-4000-8000-000000000001';
const FLAGGED = '20000000-0000-4000-8000-000000000002';
const GENUINE = '20000000-0000-4000-8000-000000000003';

async function seed(): Promise<void> {
  // Schema-qualified deliberately. search_path would resolve these to the
  // scratch copies, but this test runs against the shared database and an
  // unqualified TRUNCATE here would be catastrophic if the scratch tables were
  // ever missing.
  await scoped(
    `TRUNCATE ${SCHEMA}.attendance_entries, ${SCHEMA}.attendance_daily_summaries,` +
      ` ${SCHEMA}.attendance_exceptions`
  );
  // A fabricated closure: exactly clock_in + 9h, no missing_clock_out exception.
  await scoped(
    `INSERT INTO attendance_entries
       (id, staff_id, work_date, clock_in_at, clock_out_at, received_at_out, status, notes)
     VALUES ($1, $2, DATE '2026-05-04', TIMESTAMPTZ '2026-05-04T06:00:00Z',
             TIMESTAMPTZ '2026-05-04T15:00:00Z', TIMESTAMPTZ '2026-05-05T00:45:00Z',
             'auto_closed', 'original note')`,
    [FABRICATED, `${STAFF}1`]
  );
  // Same 9h shape, but correctly flagged — must not be touched.
  await scoped(
    `INSERT INTO attendance_entries
       (id, staff_id, work_date, clock_in_at, clock_out_at, status)
     VALUES ($1, $2, DATE '2026-05-05', TIMESTAMPTZ '2026-05-05T06:00:00Z',
             TIMESTAMPTZ '2026-05-05T15:00:00Z', 'auto_closed')`,
    [FLAGGED, `${STAFF}2`]
  );
  await scoped(
    `INSERT INTO attendance_exceptions (entry_id, exception_kind)
     VALUES ($1, 'missing_clock_out')`,
    [FLAGGED]
  );
  // A real device clock-out that happens to be auto_closed but is not 9h.
  await scoped(
    `INSERT INTO attendance_entries
       (id, staff_id, work_date, clock_in_at, clock_out_at, status)
     VALUES ($1, $2, DATE '2026-05-06', TIMESTAMPTZ '2026-05-06T06:00:00Z',
             TIMESTAMPTZ '2026-05-06T13:30:00Z', 'auto_closed')`,
    [GENUINE, `${STAFF}3`]
  );
  await scoped(
    `INSERT INTO attendance_daily_summaries
       (staff_id, work_date, regular_hrs, overtime_hrs, night_hrs)
     VALUES ($1, DATE '2026-05-04', 9.00, 0.00, 0.55),
            ($2, DATE '2026-05-05', 9.00, 0.00, 0.00),
            ($3, DATE '2026-05-06', 7.50, 0.00, 0.00)`,
    [`${STAFF}1`, `${STAFF}2`, `${STAFF}3`]
  );
}

dbDescribe('migration 479 applied to a scratch schema', () => {
  beforeAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await scoped(prerequisites);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    const leaked = await pool.query(
      `SELECT COUNT(*)::int AS n FROM pg_namespace WHERE nspname = $1`,
      [SCHEMA]
    );
    expect(leaked.rows[0].n).toBe(0);
    await pool.end();
  }, 60_000);

  it('clears the fabricated clock-out, zeroes its legacy hours, and backs both up', async () => {
    await seed();
    await scoped(FORWARD);

    const entry = await scoped<{ clock_out_at: Date | null; received_at_out: Date | null; notes: string }>(
      `SELECT clock_out_at, received_at_out, notes, status FROM attendance_entries WHERE id = $1`,
      [FABRICATED]
    );
    expect(entry.rows[0].clock_out_at).toBeNull();
    expect(entry.rows[0].received_at_out).toBeNull();
    expect(entry.rows[0].notes).toContain('original note');
    expect(entry.rows[0].notes).toContain('migration 479');

    const summary = await scoped<{ regular_hrs: string; night_hrs: string }>(
      `SELECT regular_hrs::text, night_hrs::text FROM attendance_daily_summaries
       WHERE staff_id = $1 AND work_date = DATE '2026-05-04'`,
      [`${STAFF}1`]
    );
    expect(Number(summary.rows[0].regular_hrs)).toBe(0);
    expect(Number(summary.rows[0].night_hrs)).toBe(0);

    const backup = await scoped<{ clock_out_at: Date; notes: string; regular_hrs: string; night_hrs: string }>(
      `SELECT clock_out_at, notes, regular_hrs::text, night_hrs::text
       FROM attendance_legacy_autoclose_backup WHERE entry_id = $1`,
      [FABRICATED]
    );
    expect(backup.rows).toHaveLength(1);
    expect(backup.rows[0].notes).toBe('original note');
    expect(Number(backup.rows[0].regular_hrs)).toBe(9);
    expect(Number(backup.rows[0].night_hrs)).toBe(0.55);
  });

  it('leaves a correctly flagged closure and a non-9h closure untouched', async () => {
    const untouched = await scoped<{ id: string }>(
      `SELECT id FROM attendance_entries WHERE clock_out_at IS NOT NULL ORDER BY work_date`
    );
    expect(untouched.rows.map((r) => r.id)).toEqual([FLAGGED, GENUINE]);

    const backedUp = await scoped<{ entry_id: string }>(
      `SELECT entry_id FROM attendance_legacy_autoclose_backup`
    );
    expect(backedUp.rows.map((r) => r.entry_id)).toEqual([FABRICATED]);

    const kept = await scoped<{ regular_hrs: string }>(
      `SELECT regular_hrs::text FROM attendance_daily_summaries
       WHERE staff_id = $1 AND work_date = DATE '2026-05-05'`,
      [`${STAFF}2`]
    );
    expect(Number(kept.rows[0].regular_hrs)).toBe(9);
  });

  it('backdates the policy to the first fabricated closure', async () => {
    const policy = await scoped<{ active_from: string }>(
      `SELECT TO_CHAR(active_from, 'YYYY-MM-DD') AS active_from FROM attendance_schedule_policies`
    );
    expect(policy.rows[0].active_from).toBe('2026-04-25');
  });

  it('is rerunnable without double-appending the note or re-zeroing', async () => {
    await scoped(FORWARD);
    await scoped(FORWARD);

    const entry = await scoped<{ notes: string }>(
      `SELECT notes FROM attendance_entries WHERE id = $1`,
      [FABRICATED]
    );
    const occurrences = entry.rows[0].notes.split('migration 479').length - 1;
    expect(occurrences).toBe(1);

    const backup = await scoped<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM attendance_legacy_autoclose_backup`
    );
    expect(backup.rows[0].n).toBe(1);
  });

  it('rollback restores the entry, its notes, its legacy hours, and the policy date', async () => {
    await scoped(
      `INSERT INTO schema_migrations (filename)
       VALUES ('479_attendance_legacy_autoclose_evidence_reset.sql')`
    );
    await scoped(ROLLBACK);

    const entry = await scoped<{ clock_out_at: Date; received_at_out: Date; notes: string }>(
      `SELECT clock_out_at, received_at_out, notes FROM attendance_entries WHERE id = $1`,
      [FABRICATED]
    );
    expect(entry.rows[0].clock_out_at.toISOString()).toBe('2026-05-04T15:00:00.000Z');
    expect(entry.rows[0].received_at_out.toISOString()).toBe('2026-05-05T00:45:00.000Z');
    expect(entry.rows[0].notes).toBe('original note');

    const summary = await scoped<{ regular_hrs: string; night_hrs: string }>(
      `SELECT regular_hrs::text, night_hrs::text FROM attendance_daily_summaries
       WHERE staff_id = $1 AND work_date = DATE '2026-05-04'`,
      [`${STAFF}1`]
    );
    expect(Number(summary.rows[0].regular_hrs)).toBe(9);
    expect(Number(summary.rows[0].night_hrs)).toBe(0.55);

    const policy = await scoped<{ active_from: string }>(
      `SELECT TO_CHAR(active_from, 'YYYY-MM-DD') AS active_from FROM attendance_schedule_policies`
    );
    expect(policy.rows[0].active_from).toBe('2026-08-03');

    const table = await scoped<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'attendance_legacy_autoclose_backup'`,
      [SCHEMA]
    );
    expect(table.rows[0].n).toBe(0);

    const tracker = await scoped<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM schema_migrations
       WHERE filename = '479_attendance_legacy_autoclose_evidence_reset.sql'`
    );
    expect(tracker.rows[0].n).toBe(0);
  });

  it('re-applies cleanly after rollback', async () => {
    await scoped(FORWARD);

    const entry = await scoped<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1`,
      [FABRICATED]
    );
    expect(entry.rows[0].clock_out_at).toBeNull();

    const backup = await scoped<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM attendance_legacy_autoclose_backup`
    );
    expect(backup.rows[0].n).toBe(1);
  });
});
