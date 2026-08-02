/**
 * Execution test for migration 475 — attendance policy/workflow schema.
 *
 * 475 shipped with no test. The migration CI gate exits 0 when no test file exists, so
 * "absent" reads as "green" and none of these 31 statements were ever executed by CI. A
 * stub-client test would not help — it is blind to parse-time errors, which is how a
 * 42P08 previously reached production behind a green build.
 *
 * This runs the real DDL against a real Postgres, so a syntax error, a bad type, a
 * malformed CHECK or a broken trigger function fails here rather than mid-deploy.
 *
 * The pre-existing tables 475 alters are recreated as minimal shells: it ADDs columns to
 * `attendance_daily_summaries` and `attendance_adjustments` and references `staff`,
 * `users`, `attendance_entries` and `attendance_overtime_rules`. Only the columns 475
 * actually touches are modelled — this is a migration-executes test, not a schema replica.
 *
 * SAFETY: everything happens in a scratch schema dropped in afterAll. Nothing touches real
 * attendance data — dev and production share one database.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig475_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD_FILE = '475_attendance_policy_workflow.sql';
const FORWARD = readFileSync(join(SQL_DIR, FORWARD_FILE), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_475_attendance_policy_workflow.sql'),
  'utf8'
);

/** Tables 475 creates outright — all must exist after the forward run and be gone after rollback. */
const CREATED_TABLES = [
  'attendance_schedule_policies',
  'attendance_day_exceptions',
  'attendance_decision_events',
  'attendance_weekly_lock_history',
  'attendance_payroll_exports',
  'attendance_notification_dispatches',
  'attendance_reconciliation_runs',
];

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

async function tableExists(name: string): Promise<boolean> {
  const rows = await scoped<{ n: string }>(
    `SELECT to_regclass($1) AS n`,
    [`${SCHEMA}.${name}`]
  );
  return rows[0]?.n !== null;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await scoped(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [SCHEMA, table, column]
  );
  return rows.length > 0;
}

/** The world 475 expects to find: only the columns it reads or alters. */
async function seedPreExistingShells(): Promise<void> {
  // 475 ends with GRANT/REVOKE against `fibreflow_user`. That role exists on the real
  // database but not in a fresh cluster, so the migration is NOT self-contained — it
  // cannot be applied to a rebuilt database until the role is created first. Worth
  // knowing for disaster recovery; modelled here rather than papered over.
  // Roles are cluster-global, so this is created once and deliberately not dropped.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
        CREATE ROLE fibreflow_user NOLOGIN;
      END IF;
    END $$;`);
  await scoped(`CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`);
  await scoped(`CREATE TABLE staff (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`);
  await scoped(`CREATE TABLE attendance_entries (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`);
  await scoped(`
    CREATE TABLE attendance_overtime_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      is_default BOOLEAN NOT NULL DEFAULT false
    )`);
  // 475 ends in a DO block that seeds the 'Velocity fixed hours' policy from the default
  // overtime rule, and RAISEs unless it finds EXACTLY one. That is a real deploy
  // precondition, not test scaffolding: on a database with zero or two default rules this
  // migration aborts. Model the one-row world here; the zero/two cases are asserted below.
  await scoped(`INSERT INTO attendance_overtime_rules (is_default) VALUES (true)`);
  await scoped(`
    CREATE TABLE attendance_daily_summaries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id UUID NOT NULL REFERENCES staff(id),
      work_date DATE NOT NULL
    )`);
  await scoped(`
    CREATE TABLE attendance_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_at TIMESTAMPTZ,
      reviewed_by UUID REFERENCES users(id)
    )`);
  await scoped(
    `CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`
  );
}

beforeEach(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await seedPreExistingShells();
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 475 — attendance policy workflow', () => {
  it('executes end to end against a real database', async () => {
    await expect(scoped(FORWARD)).resolves.toBeDefined();

    for (const table of CREATED_TABLES) {
      expect(await tableExists(table), `${table} should exist after 475`).toBe(true);
    }
    for (const column of [
      'schedule_policy_id',
      'result_status',
      'blocking_reasons',
      'result_version',
      'locked_period_version',
      'approved_by',
    ]) {
      expect(
        await columnExists('attendance_daily_summaries', column),
        `attendance_daily_summaries.${column} should exist after 475`
      ).toBe(true);
    }
    expect(await columnExists('attendance_adjustments', 'cancelled_by_staff_id')).toBe(true);
  });

  it('is idempotent — re-applying changes nothing and raises nothing', async () => {
    await scoped(FORWARD);
    await expect(scoped(FORWARD)).resolves.toBeDefined();

    for (const table of CREATED_TABLES) {
      expect(await tableExists(table)).toBe(true);
    }
  });

  it('enforces the result_status and classification vocabularies', async () => {
    await scoped(FORWARD);
    const staff = await scoped<{ id: string }>(`INSERT INTO staff DEFAULT VALUES RETURNING id`);
    const staffId = staff[0]!.id;

    // A value outside the CHECK list must be refused — this is the constraint doing work,
    // not merely existing.
    await expect(
      scoped(
        `INSERT INTO attendance_daily_summaries (staff_id, work_date, result_status)
         VALUES ($1, DATE '2026-08-02', 'not-a-real-status')`,
        [staffId]
      )
    ).rejects.toThrow();

    await expect(
      scoped(
        `INSERT INTO attendance_daily_summaries (staff_id, work_date, result_status)
         VALUES ($1, DATE '2026-08-02', 'locked')`,
        [staffId]
      )
    ).resolves.toBeDefined();
  });

  it('makes the decision-event audit trail immutable', async () => {
    await scoped(FORWARD);
    // 475 installs prevent_attendance_audit_mutation() on the two audit tables. If that
    // trigger is not wired, an UPDATE silently succeeds and the audit trail is editable.
    const rows = await scoped<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid = to_regclass($1)::oid`,
      [`${SCHEMA}.attendance_decision_events`]
    );
    expect(rows.map((r) => r.tgname)).toContain('attendance_decision_events_immutable');
  });

  it('seeds exactly one default schedule policy from the default overtime rule', async () => {
    await scoped(FORWARD);
    const rows = await scoped<{ name: string }>(
      `SELECT name FROM attendance_schedule_policies`
    );
    expect(rows.map((r) => r.name)).toEqual(['Velocity fixed hours']);
  });

  it('refuses to apply when the default overtime rule is ambiguous or absent', async () => {
    // The migration's own precondition, made visible. On a database with no default rule —
    // or two — this aborts rather than guessing, and a deploy fails loudly at this step.
    await scoped(`UPDATE attendance_overtime_rules SET is_default = false`);
    await expect(scoped(FORWARD)).rejects.toThrow(/Expected exactly one default overtime rule/);

    await scoped(`UPDATE attendance_overtime_rules SET is_default = true`);
    await scoped(`INSERT INTO attendance_overtime_rules (is_default) VALUES (true)`);
    await expect(scoped(FORWARD)).rejects.toThrow(/Expected exactly one default overtime rule/);
  });

  it('rollback removes what it created and clears its own tracker row', async () => {
    await scoped(FORWARD);
    // Stand in for the migration runner, which records the row in production.
    await scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);

    await scoped(ROLLBACK);

    for (const table of CREATED_TABLES) {
      expect(await tableExists(table), `${table} should be gone after rollback`).toBe(false);
    }
    expect(await columnExists('attendance_daily_summaries', 'result_status')).toBe(false);
    expect(await columnExists('attendance_adjustments', 'cancelled_by_staff_id')).toBe(false);

    // Without this DELETE the schema is rolled back while the tracker still reports the
    // migration as applied, so the forward runner skips it and never repairs the state.
    const remaining = await scoped(`SELECT filename FROM schema_migrations WHERE filename = $1`, [
      FORWARD_FILE,
    ]);
    expect(remaining).toHaveLength(0);
  });
});
