import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import type { RemediationClient } from '../../../src/services/attendance/remediation/legacyAutocloseReset';

/**
 * Shared scratch-schema harness for the legacy auto-close remediation specs.
 *
 * Each spec passes its own schema name — vitest runs files in parallel, so two
 * specs sharing a scratch schema would race on TRUNCATE.
 *
 * The client holds ONE connection for the whole spec rather than taking a
 * pooled connection per statement: per-statement connections would silently
 * run every statement in its own autocommit transaction, leaving
 * BEGIN/COMMIT/ROLLBACK completely uncovered.
 */
export interface AutocloseHarness {
  client: RemediationClient;
  pool: Pool;
  schema: string;
  setup(): Promise<void>;
  teardown(): Promise<number>;
  reset(): Promise<void>;
  seedFabricated(entryId: string, staffId: string, day: string): Promise<void>;
  hours(staffId: string, day: string): Promise<number>;
}

export const STAFF = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
export const ENTRY = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;
export const POLICY_ID = '30000000-0000-4000-8000-000000000001';

const PREREQ = `
  CREATE TABLE attendance_entries (
    id UUID PRIMARY KEY, staff_id UUID NOT NULL, work_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL, clock_out_at TIMESTAMPTZ,
    received_at_out TIMESTAMPTZ, status VARCHAR NOT NULL, notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  -- NUMERIC(5,2) and the CHECKs mirror migration 319 so a constraint violation
  -- that would abort the real transaction also aborts here.
  CREATE TABLE attendance_daily_summaries (
    staff_id UUID NOT NULL, work_date DATE NOT NULL,
    regular_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (regular_hrs BETWEEN 0 AND 24),
    overtime_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (overtime_hrs BETWEEN 0 AND 15),
    sunday_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (sunday_hrs BETWEEN 0 AND 24),
    holiday_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (holiday_hrs BETWEEN 0 AND 24),
    night_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (night_hrs BETWEEN 0 AND 24),
    wage_amount_cents BIGINT, result_status TEXT, calculation_fingerprint TEXT,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (staff_id, work_date)
  );
  CREATE TABLE attendance_exceptions (
    id BIGSERIAL PRIMARY KEY, entry_id UUID NOT NULL, exception_kind TEXT NOT NULL);
  -- entry_id is nullable in production (ON DELETE SET NULL, and
  -- insertExceptionWithoutEntry writes NULL), which is why the remediation's
  -- guard keys on the day rather than the entry.
  CREATE TABLE attendance_day_exceptions (
    id BIGSERIAL PRIMARY KEY, entry_id UUID, staff_id UUID NOT NULL,
    work_date DATE NOT NULL, kind TEXT NOT NULL);
  CREATE TABLE attendance_weekly_locks (
    week_start_date DATE PRIMARY KEY CHECK (EXTRACT(DOW FROM week_start_date) = 1),
    unlocked_at TIMESTAMPTZ);
  CREATE TABLE attendance_schedule_policies (
    id UUID PRIMARY KEY, active_from DATE NOT NULL, active_to DATE);`;

export function createHarness(schema: string, databaseUrl: string | undefined): AutocloseHarness {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 2, connectionTimeoutMillis: 10_000 });
  let conn: PoolClient;
  const client: RemediationClient = {
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string, values: readonly unknown[] = [],
    ): Promise<QueryResult<T>> {
      return conn.query<T>(text, values as unknown[]);
    },
  };

  return {
    client, pool, schema,
    async setup() {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.query(`CREATE SCHEMA ${schema}`);
      conn = await pool.connect();
      await conn.query(`SET search_path = ${schema}`);
      await client.query(PREREQ);
    },
    async teardown() {
      conn.release();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      const { rows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_namespace WHERE nspname = $1`, [schema]);
      await pool.end();
      return rows[0]!.n;
    },
    async reset() {
      await client.query(`TRUNCATE ${schema}.attendance_entries, ${schema}.attendance_daily_summaries,
        ${schema}.attendance_exceptions, ${schema}.attendance_day_exceptions,
        ${schema}.attendance_weekly_locks`);
      await client.query(`DROP TABLE IF EXISTS ${schema}.attendance_legacy_autoclose_backup,
        ${schema}.attendance_legacy_autoclose_summary_backup,
        ${schema}.attendance_legacy_autoclose_policy_backup`);
      await client.query(`DELETE FROM attendance_schedule_policies`);
      await client.query(
        `INSERT INTO attendance_schedule_policies (id, active_from) VALUES ($1::uuid, DATE '2026-08-03')`,
        [POLICY_ID]);
    },
    /** A fabricated closure: exactly clock_in + 9h, no missing_clock_out anywhere. */
    async seedFabricated(entryId: string, staffId: string, day: string) {
      await client.query(
        `INSERT INTO attendance_entries
           (id, staff_id, work_date, clock_in_at, clock_out_at, received_at_out, status, notes)
         VALUES ($1::uuid, $2::uuid, $3::date, ($3 || ' 06:00Z')::timestamptz,
                 ($3 || ' 15:00Z')::timestamptz, ($3 || ' 22:45Z')::timestamptz,
                 'auto_closed', 'original note')`, [entryId, staffId, day]);
      await client.query(
        `INSERT INTO attendance_daily_summaries (staff_id, work_date, regular_hrs, night_hrs)
         VALUES ($1::uuid, $2::date, 9.00, 0.55)
         ON CONFLICT (staff_id, work_date) DO NOTHING`, [staffId, day]);
    },
    async hours(staffId: string, day: string) {
      const { rows } = await client.query<{ regular_hrs: string }>(
        `SELECT regular_hrs::text FROM attendance_daily_summaries
         WHERE staff_id = $1::uuid AND work_date = $2::date`, [staffId, day]);
      return Number(rows[0]?.regular_hrs);
    },
  };
}
