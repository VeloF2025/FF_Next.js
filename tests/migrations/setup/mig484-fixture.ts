/**
 * Shared fixture for the migration 484 tests.
 *
 * Lives under setup/ so vitest.migrations.config.ts's include glob
 * ('tests/migrations/**\/*.test.ts') does not collect it as a test file.
 *
 * The forward and rollback suites each own a distinct scratch schema so they
 * cannot see each other's rows. fileParallelism is false in the migrations
 * config, so they run serially against one container, but separate schemas keep
 * them independent regardless.
 *
 * The tables mirror migration 475's real DDL — the pinned CHECK constraints, the
 * partial unique index, and the NO ACTION foreign keys — rather than a
 * simplified stand-in, because the migration under test has to coexist with all
 * three.
 */

import { Pool } from 'pg';

/** The earliest attendance_entries.work_date in production. */
export const ERA_START = '2026-04-24';
/** active_from of the policy migration 475 seeds. */
export const CUTOVER = '2026-08-03';
export const HISTORICAL_NAME = 'Velocity fixed hours (pre-cutover)';
export const CURRENT_NAME = 'Velocity fixed hours';
export const RULE_ID = '600f80f0-593a-4f31-a434-cfeeeccda7c6';

export interface PolicyRow {
  name: string;
  active_from: string;
  active_to: string | null;
  overtime_rule_id: string;
  weekday_start: string;
  weekday_end: string;
}

export function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Bind query helpers to one scratch schema. */
export function fixture(pool: Pool, schema: string) {
  async function scoped<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}, public`);
      const r = await client.query(sql, params);
      return (r.rows ?? []) as T[];
    } finally {
      client.release();
    }
  }

  async function createSchema(): Promise<void> {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${schema}`);
  }

  async function dropSchema(): Promise<void> {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }

  /** Rebuild every table from scratch so each case starts from a known state. */
  async function resetTables(): Promise<void> {
    await scoped(`DROP TABLE IF EXISTS attendance_daily_summaries`);
    await scoped(`DROP TABLE IF EXISTS attendance_reconciliation_runs`);
    await scoped(`DROP TABLE IF EXISTS attendance_entries`);
    await scoped(`DROP TABLE IF EXISTS attendance_schedule_policies`);
    await scoped(`DROP TABLE IF EXISTS attendance_overtime_rules`);
    await scoped(`DROP TABLE IF EXISTS schema_migrations`);

    await scoped(`
      CREATE TABLE attendance_overtime_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        is_default boolean NOT NULL DEFAULT false
      )`);

    await scoped(`
      CREATE TABLE attendance_schedule_policies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
        active_from date NOT NULL,
        active_to date,
        weekday_start time NOT NULL DEFAULT '08:00',
        weekday_end time NOT NULL DEFAULT '17:00',
        weekday_unpaid_break_minutes int NOT NULL DEFAULT 60
          CHECK (weekday_unpaid_break_minutes = 60),
        weekday_paid_cap_hrs numeric(4,2) NOT NULL DEFAULT 8
          CHECK (weekday_paid_cap_hrs = 8),
        saturday_start time NOT NULL DEFAULT '08:00',
        saturday_end time NOT NULL DEFAULT '13:00',
        saturday_paid_cap_hrs numeric(4,2) NOT NULL DEFAULT 5
          CHECK (saturday_paid_cap_hrs = 5),
        sunday_scheduled boolean NOT NULL DEFAULT false CHECK (sunday_scheduled = false),
        sunday_missing_out_cap_hrs numeric(4,2) NOT NULL DEFAULT 5
          CHECK (sunday_missing_out_cap_hrs = 5),
        late_alert_minutes int NOT NULL DEFAULT 15 CHECK (late_alert_minutes >= 0),
        overtime_rule_id uuid NOT NULL REFERENCES attendance_overtime_rules(id),
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        CHECK (active_to IS NULL OR active_to >= active_from)
      )`);
    await scoped(`
      CREATE UNIQUE INDEX attendance_schedule_policies_one_open
        ON attendance_schedule_policies ((active_to IS NULL)) WHERE active_to IS NULL`);

    // Only work_date matters to the migration's boundary cross-check.
    await scoped(`
      CREATE TABLE attendance_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        work_date date NOT NULL
      )`);

    await scoped(`
      CREATE TABLE attendance_daily_summaries (
        staff_id uuid NOT NULL,
        work_date date NOT NULL,
        schedule_policy_id uuid REFERENCES attendance_schedule_policies(id),
        PRIMARY KEY (staff_id, work_date)
      )`);
    await scoped(`
      CREATE TABLE attendance_reconciliation_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        schedule_policy_id uuid REFERENCES attendance_schedule_policies(id)
      )`);
    await scoped(
      `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`,
    );

    await scoped(`INSERT INTO attendance_overtime_rules (id, is_default) VALUES ($1, true)`, [
      RULE_ID,
    ]);
  }

  /** Seed the existing policy the way migration 475 does. */
  async function seedCurrentPolicy(activeFrom: string = CUTOVER): Promise<void> {
    await scoped(
      `INSERT INTO attendance_schedule_policies (name, active_from, overtime_rule_id)
       VALUES ($1, $2::date, $3::uuid)`,
      [CURRENT_NAME, activeFrom, RULE_ID],
    );
  }

  /** Seed a bounded policy — used to build gap and overlap shapes. */
  async function seedPolicy(name: string, from: string, to: string | null): Promise<void> {
    await scoped(
      `INSERT INTO attendance_schedule_policies (name, active_from, active_to, overtime_rule_id)
       VALUES ($1, $2::date, $3::date, $4::uuid)`,
      [name, from, to, RULE_ID],
    );
  }

  async function addEntry(workDate: string): Promise<void> {
    await scoped(`INSERT INTO attendance_entries (work_date) VALUES ($1::date)`, [workDate]);
  }

  async function policies(): Promise<PolicyRow[]> {
    return scoped<PolicyRow>(`
      SELECT name, active_from::text, active_to::text, overtime_rule_id::text,
             weekday_start::text, weekday_end::text
      FROM attendance_schedule_policies ORDER BY active_from`);
  }

  async function historical(): Promise<PolicyRow | undefined> {
    return (await policies()).find((p) => p.name === HISTORICAL_NAME);
  }

  async function policyId(name: string): Promise<string> {
    const rows = await scoped<{ id: string }>(
      `SELECT id::text FROM attendance_schedule_policies WHERE name = $1`,
      [name],
    );
    return rows[0]!.id;
  }

  async function trackerCount(filename: string): Promise<number> {
    const rows = await scoped<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM schema_migrations WHERE filename = $1`,
      [filename],
    );
    return Number(rows[0]!.n);
  }

  /** Run SQL, returning the error message instead of throwing. */
  async function attempt(sql: string): Promise<string> {
    try {
      await scoped(sql);
      return '';
    } catch (err) {
      return (err as { message?: string }).message ?? 'unknown';
    }
  }

  return {
    scoped,
    createSchema,
    dropSchema,
    resetTables,
    seedCurrentPolicy,
    seedPolicy,
    addEntry,
    policies,
    historical,
    policyId,
    trackerCount,
    attempt,
  };
}
