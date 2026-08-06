/**
 * Integration test for migration 484 — pre-cutover attendance schedule policy.
 *
 * Executes the real forward and rollback SQL against an ephemeral Postgres in a
 * scratch schema (see tests/migrations/setup/global-setup.ts), so the files
 * themselves are exercised rather than whatever shape a live database is in.
 *
 * The behaviour that matters is coverage without overlap. findEffectivePolicy()
 * resolves with ORDER BY active_from DESC LIMIT 1, so two rows covering one date
 * silently pick a winner instead of failing — which is why active_to is derived
 * from the existing boundary rather than hardcoded, and why that derivation is
 * tested against a boundary other than the production one.
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

const SCHEMA = 'mig484_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD_FILE = '484_attendance_historical_schedule_policy.sql';
const FORWARD = readFileSync(join(SQL_DIR, FORWARD_FILE), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_484_attendance_historical_schedule_policy.sql'),
  'utf8',
);

const HISTORICAL_NAME = 'Velocity fixed hours (pre-cutover)';
/** The earliest attendance_entries.work_date in production. */
const ERA_START = '2026-04-24';
/** active_from of the policy migration 475 seeds. */
const CUTOVER = '2026-08-03';
const RULE_ID = '600f80f0-593a-4f31-a434-cfeeeccda7c6';

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

interface PolicyRow {
  name: string;
  active_from: string;
  active_to: string | null;
  overtime_rule_id: string;
  weekday_start: string;
  weekday_end: string;
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

/** Seed the existing policy the way migration 475 does. */
async function seedCurrentPolicy(activeFrom: string = CUTOVER): Promise<void> {
  await scoped(
    `INSERT INTO attendance_schedule_policies (name, active_from, overtime_rule_id)
     VALUES ('Velocity fixed hours', $1::date, $2::uuid)`,
    [activeFrom, RULE_ID],
  );
}

async function runForward(): Promise<string> {
  try {
    await scoped(FORWARD);
    return '';
  } catch (err) {
    return (err as { message?: string }).message ?? 'unknown';
  }
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
});

beforeEach(async () => {
  // Rebuild each time so idempotency and rollback start from a known state
  // rather than whatever the previous case left behind.
  await scoped(`DROP TABLE IF EXISTS attendance_daily_summaries`);
  await scoped(`DROP TABLE IF EXISTS attendance_reconciliation_runs`);
  await scoped(`DROP TABLE IF EXISTS attendance_schedule_policies`);
  await scoped(`DROP TABLE IF EXISTS attendance_overtime_rules`);
  await scoped(`DROP TABLE IF EXISTS schema_migrations`);

  await scoped(`
    CREATE TABLE attendance_overtime_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      is_default boolean NOT NULL DEFAULT false
    )`);

  // Mirrors migration 475: the pinned CHECKs and the one-open-policy index are
  // what the migration has to coexist with, so they are reproduced rather than
  // simplified away.
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
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('migration 484 — pre-cutover attendance schedule policy', () => {
  it('covers the era from the first attendance record to the day before cutover', async () => {
    await seedCurrentPolicy();
    expect(await runForward()).toBe('');

    const row = await historical();
    expect(row).toBeDefined();
    expect(row!.active_from).toBe(ERA_START);
    expect(row!.active_to).toBe('2026-08-02');
  });

  it('leaves no uncovered day between the two policies', async () => {
    await seedCurrentPolicy();
    await runForward();

    // Contiguity is the point of the migration: a gap would reintroduce the
    // very "no policy covers this date" failure it exists to remove.
    const [historicalRow, current] = await policies();
    expect(historicalRow!.name).toBe(HISTORICAL_NAME);
    const gapDays = await scoped<{ gap: string }>(
      `SELECT ($2::date - $1::date)::text AS gap`,
      [historicalRow!.active_to, current!.active_from],
    );
    expect(gapDays[0]!.gap).toBe('1'); // exactly adjacent, no missing day
  });

  it('never overlaps the existing policy', async () => {
    await seedCurrentPolicy();
    await runForward();

    // An overlap is silent — findEffectivePolicy takes ORDER BY active_from
    // DESC LIMIT 1 — so assert it structurally rather than trusting the dates.
    const overlaps = await scoped<{ n: string }>(`
      SELECT COUNT(*)::text AS n
      FROM attendance_schedule_policies a
      JOIN attendance_schedule_policies b ON b.id <> a.id
      WHERE a.active_from <= COALESCE(b.active_to, DATE '9999-12-31')
        AND COALESCE(a.active_to, DATE '9999-12-31') >= b.active_from`);
    expect(Number(overlaps[0]!.n)).toBe(0);
  });

  it('derives active_to from the existing boundary rather than hardcoding it', async () => {
    // The production boundary is 2026-08-03. If active_to were hardcoded to
    // 2026-08-02 this case would leave a two-week gap and still pass the
    // first test, so it is the one that pins the derivation.
    await seedCurrentPolicy('2026-08-17');
    expect(await runForward()).toBe('');

    const row = await historical();
    expect(row!.active_to).toBe('2026-08-16');
  });

  it('does not create a second open-ended policy', async () => {
    await seedCurrentPolicy();
    await runForward();

    const open = await scoped<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM attendance_schedule_policies WHERE active_to IS NULL`,
    );
    expect(Number(open[0]!.n)).toBe(1);
  });

  it('carries the same schedule and overtime rule as the current policy', async () => {
    await seedCurrentPolicy();
    await runForward();

    const row = await historical();
    expect(row!.weekday_start).toBe('08:00:00');
    expect(row!.weekday_end).toBe('17:00:00');
    expect(row!.overtime_rule_id).toBe(RULE_ID);
  });

  it('is a no-op when the era is already covered', async () => {
    await seedCurrentPolicy(ERA_START);
    expect(await runForward()).toBe('');

    expect(await historical()).toBeUndefined();
    expect(await policies()).toHaveLength(1);
  });

  it('is a no-op when an earlier policy already starts before the era', async () => {
    await seedCurrentPolicy('2026-01-01');
    expect(await runForward()).toBe('');
    expect(await historical()).toBeUndefined();
  });

  it('blocks when no policy exists to sit before', async () => {
    // Migration 475 seeds the current policy. Running 484 first would otherwise
    // insert an unbounded historical row with nothing to be contiguous with.
    const message = await runForward();
    expect(message).toContain('Migration 484 preflight');
    expect(message).toContain('empty');
    expect(await policies()).toHaveLength(0);
  });

  it('blocks when the default overtime rule is ambiguous', async () => {
    await seedCurrentPolicy();
    await scoped(`INSERT INTO attendance_overtime_rules (is_default) VALUES (true)`);

    const message = await runForward();
    expect(message).toContain('exactly one default overtime rule');
    expect(await historical()).toBeUndefined();
  });

  it('blocks when no rule is marked default', async () => {
    await seedCurrentPolicy();
    await scoped(`UPDATE attendance_overtime_rules SET is_default = false`);

    const message = await runForward();
    expect(message).toContain('exactly one default overtime rule');
    expect(await historical()).toBeUndefined();
  });

  it('is re-runnable', async () => {
    await seedCurrentPolicy();
    expect(await runForward()).toBe('');
    expect(await runForward()).toBe('');

    // Re-running must not stack a second historical row, which would overlap
    // the first and make policy resolution order-dependent.
    const rows = (await policies()).filter((p) => p.name === HISTORICAL_NAME);
    expect(rows).toHaveLength(1);
  });

  it('rollback removes the policy and clears its own tracker row', async () => {
    await seedCurrentPolicy();
    await runForward();
    await scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);

    await scoped(ROLLBACK);

    expect(await historical()).toBeUndefined();
    const tracked = await scoped<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM schema_migrations WHERE filename = $1`,
      [FORWARD_FILE],
    );
    expect(Number(tracked[0]!.n)).toBe(0);
    // The current policy is untouched — the rollback is scoped to its own row.
    expect(await policies()).toHaveLength(1);
  });

  it('rollback refuses while daily summaries still reference the policy', async () => {
    await seedCurrentPolicy();
    await runForward();
    const row = await scoped<{ id: string }>(
      `SELECT id::text FROM attendance_schedule_policies WHERE name = $1`,
      [HISTORICAL_NAME],
    );
    await scoped(
      `INSERT INTO attendance_daily_summaries (staff_id, work_date, schedule_policy_id)
       VALUES (gen_random_uuid(), DATE '2026-05-15', $1::uuid)`,
      [row[0]!.id],
    );
    await scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);

    let message = '';
    try {
      await scoped(ROLLBACK);
    } catch (err) {
      message = (err as { message?: string }).message ?? '';
    }

    expect(message).toContain('Rollback 484');
    expect(message).toContain('used to project');
    // And it must not have half-rolled-back: policy present, tracker intact.
    expect(await historical()).toBeDefined();
    const tracked = await scoped<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM schema_migrations WHERE filename = $1`,
      [FORWARD_FILE],
    );
    expect(Number(tracked[0]!.n)).toBe(1);
  });

  it('rollback refuses while reconciliation runs still reference the policy', async () => {
    await seedCurrentPolicy();
    await runForward();
    const row = await scoped<{ id: string }>(
      `SELECT id::text FROM attendance_schedule_policies WHERE name = $1`,
      [HISTORICAL_NAME],
    );
    await scoped(
      `INSERT INTO attendance_reconciliation_runs (schedule_policy_id) VALUES ($1::uuid)`,
      [row[0]!.id],
    );

    let message = '';
    try {
      await scoped(ROLLBACK);
    } catch (err) {
      message = (err as { message?: string }).message ?? '';
    }

    expect(message).toContain('Rollback 484');
    expect(await historical()).toBeDefined();
  });

  it('rollback is re-runnable', async () => {
    await seedCurrentPolicy();
    await runForward();
    await scoped(ROLLBACK);
    await expect(scoped(ROLLBACK)).resolves.toBeDefined();
    expect(await historical()).toBeUndefined();
  });

  it('forward re-applies cleanly after a rollback', async () => {
    await seedCurrentPolicy();
    await runForward();
    await scoped(ROLLBACK);

    expect(await runForward()).toBe('');
    expect(await historical()).toBeDefined();
  });
});
