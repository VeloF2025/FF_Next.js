import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import type { RemediationClient } from '../../../src/services/attendance/remediation/untrackedExpectationWithdrawal';

/**
 * Scratch-schema harness for the untracked-expectation withdrawal specs.
 *
 * The migration-gate container is seeded from tests/db/setup/seed.sql, which
 * carries a four-column `staff` table and no attendance tables at all — so the
 * prerequisites are built here rather than assumed, mirroring the production
 * columns and constraints the remediation actually depends on.
 *
 * The client holds ONE connection for the whole spec rather than taking a
 * pooled connection per statement: per-statement connections would silently run
 * every statement in its own autocommit transaction, leaving BEGIN/COMMIT/
 * ROLLBACK completely uncovered.
 */
export interface WithdrawalHarness {
  client: RemediationClient;
  pool: Pool;
  schema: string;
  setup(): Promise<void>;
  teardown(): Promise<number>;
  reset(): Promise<void>;
  seedStaff(staffId: string, tracked: boolean): Promise<void>;
  seedPhantom(exceptionId: string, staffId: string, day: string): Promise<void>;
  exception(exceptionId: string): Promise<ExceptionRow | undefined>;
  /** Reproduces the pre-runId one-off SQL that cleared the original 53. */
  withdrawWithoutRunId(exceptionId: string, staffId: string, day: string): Promise<void>;
  summaryJson(staffId: string, day: string): Promise<Record<string, unknown> | undefined>;
  events(entityType: string): Promise<EventRow[]>;
}

export interface ExceptionRow extends Record<string, unknown> {
  status: string;
  resolution_reason: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
}

export interface EventRow extends Record<string, unknown> {
  entity_key: string;
  action: string;
  before_value: Record<string, unknown>;
  after_value: Record<string, unknown>;
}

export const STAFF = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
export const EXC = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;
export const ENTRY = (n: number) => `30000000-0000-4000-8000-00000000000${n}`;
export const ADJUSTMENT = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;

/**
 * `attendance_day_exceptions.id` is UUID in production and the remediation
 * casts through `ANY($1::uuid[])` and `x.id::text = e.entity_key`, so a
 * BIGSERIAL stand-in would not exercise the real statements.
 *
 * attendance_decision_events carries its immutability trigger here too. The
 * rollback deliberately leaves the audit trail alone, and a trigger is the only
 * way to prove that rather than assert it.
 */
const PREREQ = `
  CREATE TABLE staff (
    id UUID PRIMARY KEY,
    attendance_tracked BOOLEAN NOT NULL DEFAULT false
  );
  CREATE TABLE attendance_entries (
    id UUID PRIMARY KEY, staff_id UUID NOT NULL, work_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL, status VARCHAR NOT NULL
  );
  CREATE TABLE attendance_daily_summaries (
    staff_id UUID NOT NULL, work_date DATE NOT NULL,
    scheduled_paid_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    leave_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    unpaid_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    result_status TEXT,
    attendance_classification TEXT,
    approved_at TIMESTAMPTZ,
    result_version BIGINT NOT NULL DEFAULT 1,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (staff_id, work_date)
  );
  CREATE TABLE attendance_day_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL, work_date DATE NOT NULL,
    entry_id UUID, adjustment_id UUID,
    kind TEXT NOT NULL, status TEXT NOT NULL,
    resolved_by UUID, resolved_at TIMESTAMPTZ, resolution_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE attendance_weekly_locks (
    week_start_date DATE PRIMARY KEY CHECK (EXTRACT(DOW FROM week_start_date) = 1),
    unlocked_at TIMESTAMPTZ
  );
  CREATE TABLE attendance_decision_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN (
      'day_exception', 'daily_result', 'weekly_lock', 'payroll_export')),
    entity_key TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_user_id UUID,
    actor_staff_id UUID,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    before_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $fn$
  BEGIN
    RAISE EXCEPTION 'attendance_decision_events is append-only';
  END;
  $fn$ LANGUAGE plpgsql;
  CREATE TRIGGER attendance_decision_events_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON attendance_decision_events
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();`;

export function createHarness(schema: string, databaseUrl: string | undefined): WithdrawalHarness {
  const pool = new Pool({
    connectionString: databaseUrl, ssl: false, max: 2, connectionTimeoutMillis: 10_000,
  });
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
      // attendance_decision_events cannot be TRUNCATEd — its own trigger
      // forbids it, exactly as in production. Dropping and recreating the table
      // is the only way to clear it between specs.
      await client.query(`TRUNCATE ${schema}.staff, ${schema}.attendance_entries,
        ${schema}.attendance_daily_summaries, ${schema}.attendance_day_exceptions,
        ${schema}.attendance_weekly_locks`);
      await client.query(`DROP TABLE ${schema}.attendance_decision_events`);
      await client.query(`
        CREATE TABLE attendance_decision_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity_type TEXT NOT NULL CHECK (entity_type IN (
            'day_exception', 'daily_result', 'weekly_lock', 'payroll_export')),
          entity_key TEXT NOT NULL,
          action TEXT NOT NULL,
          actor_user_id UUID,
          actor_staff_id UUID,
          reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
          before_value JSONB NOT NULL DEFAULT '{}'::jsonb,
          after_value JSONB NOT NULL DEFAULT '{}'::jsonb,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TRIGGER attendance_decision_events_immutable
          BEFORE UPDATE OR DELETE OR TRUNCATE ON attendance_decision_events
          FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();`);
    },
    async seedStaff(staffId: string, tracked: boolean) {
      await client.query(
        `INSERT INTO staff (id, attendance_tracked) VALUES ($1::uuid, $2::boolean)
         ON CONFLICT (id) DO UPDATE SET attendance_tracked = EXCLUDED.attendance_tracked`,
        [staffId, tracked]);
    },
    /**
     * The exact shape the pre-479 reconciler produced: an expectation-only
     * missing_clock_in with no entry and no adjustment, paired with an
     * absence_review summary carrying the scheduled hours nobody worked.
     */
    async seedPhantom(exceptionId: string, staffId: string, day: string) {
      await client.query(
        `INSERT INTO attendance_day_exceptions
           (id, staff_id, work_date, entry_id, adjustment_id, kind, status)
         VALUES ($1::uuid, $2::uuid, $3::date, NULL, NULL,
                 'missing_clock_in', 'awaiting_supervisor')`,
        [exceptionId, staffId, day]);
      await client.query(
        `INSERT INTO attendance_daily_summaries
           (staff_id, work_date, scheduled_paid_hrs, result_status)
         VALUES ($1::uuid, $2::date, 8.00, 'absence_review')
         ON CONFLICT (staff_id, work_date) DO NOTHING`, [staffId, day]);
    },
    async withdrawWithoutRunId(exceptionId: string, staffId: string, day: string) {
      await client.query(
        `INSERT INTO attendance_decision_events (entity_type, entity_key, action,
           actor_staff_id, reason, before_value, after_value)
         SELECT 'day_exception', x.id::text, 'system_withdrawn', x.staff_id, 'legacy one-off',
                jsonb_build_object('status', x.status), jsonb_build_object('status','cancelled')
         FROM attendance_day_exceptions x WHERE x.id = $1::uuid`, [exceptionId]);
      await client.query(
        `INSERT INTO attendance_decision_events (entity_type, entity_key, action,
           actor_staff_id, reason, before_value, after_value)
         SELECT 'daily_result', ds.staff_id::text || ':' || TO_CHAR(ds.work_date,'YYYY-MM-DD'),
                'system_withdrawn', ds.staff_id, 'legacy one-off',
                to_jsonb(ds), jsonb_build_object('deleted', true)
         FROM attendance_daily_summaries ds
         WHERE ds.staff_id = $1::uuid AND ds.work_date = $2::date`, [staffId, day]);
      await client.query(
        `UPDATE attendance_day_exceptions SET status='cancelled', resolved_at=NOW(),
           resolution_reason=$2::text, updated_at=NOW() WHERE id = $1::uuid`,
        [exceptionId, 'Withdrawn: staff member is not attendance_tracked (migration 479).']);
      await client.query(
        `DELETE FROM attendance_daily_summaries WHERE staff_id=$1::uuid AND work_date=$2::date`,
        [staffId, day]);
    },
    async exception(exceptionId: string) {
      const { rows } = await client.query<ExceptionRow>(
        `SELECT status, resolution_reason, resolved_at, resolved_by::text
         FROM attendance_day_exceptions WHERE id = $1::uuid`, [exceptionId]);
      return rows[0];
    },
    async summaryJson(staffId: string, day: string) {
      const { rows } = await client.query<{ row: Record<string, unknown> }>(
        `SELECT to_jsonb(ds) AS row FROM attendance_daily_summaries ds
         WHERE ds.staff_id = $1::uuid AND ds.work_date = $2::date`, [staffId, day]);
      return rows[0]?.row;
    },
    async events(entityType: string) {
      const { rows } = await client.query<EventRow>(
        `SELECT entity_key, action, before_value, after_value
         FROM attendance_decision_events WHERE entity_type = $1
         ORDER BY entity_key`, [entityType]);
      return rows;
    },
  };
}
