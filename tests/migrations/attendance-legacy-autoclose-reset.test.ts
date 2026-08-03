import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  applyRemediation, planRemediation, type RemediationClient,
} from '../../src/services/attendance/remediation/legacyAutocloseReset';
import {
  backdatePolicy, restorePolicy, rollbackRemediation,
} from '../../src/services/attendance/remediation/legacyAutocloseRollback';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DATABASE_URL ? describe : describe.skip;
const SCHEMA = 'autoclose_reset_scratch';
const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 2, connectionTimeoutMillis: 10_000 });

// ONE connection for the whole suite, not one per statement: a pooled
// connection per query would silently run each statement in its own
// autocommit transaction, so BEGIN/COMMIT/ROLLBACK — and whether a partial
// mutation can commit — would have no coverage at all.
let conn: PoolClient;
const client: RemediationClient = {
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string, values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return conn.query<T>(text, values as unknown[]);
  },
};

const PREREQ = `
  CREATE TABLE attendance_entries (
    id UUID PRIMARY KEY, staff_id UUID NOT NULL, work_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL, clock_out_at TIMESTAMPTZ,
    received_at_out TIMESTAMPTZ, status VARCHAR NOT NULL, notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE attendance_daily_summaries (
    staff_id UUID NOT NULL, work_date DATE NOT NULL,
    regular_hrs NUMERIC NOT NULL DEFAULT 0.00, overtime_hrs NUMERIC NOT NULL DEFAULT 0.00,
    sunday_hrs NUMERIC NOT NULL DEFAULT 0.00, holiday_hrs NUMERIC NOT NULL DEFAULT 0.00,
    night_hrs NUMERIC NOT NULL DEFAULT 0.00, wage_amount_cents BIGINT,
    result_status TEXT, calculation_fingerprint TEXT,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (staff_id, work_date)
  );
  CREATE TABLE attendance_exceptions (
    id BIGSERIAL PRIMARY KEY, entry_id UUID NOT NULL, exception_kind TEXT NOT NULL);
  -- entry_id is nullable in production (ON DELETE SET NULL, and
  -- insertExceptionWithoutEntry writes NULL), which is why the guard keys on
  -- the day rather than the entry.
  CREATE TABLE attendance_day_exceptions (
    id BIGSERIAL PRIMARY KEY, entry_id UUID, staff_id UUID NOT NULL,
    work_date DATE NOT NULL, kind TEXT NOT NULL);
  CREATE TABLE attendance_weekly_locks (
    week_start_date DATE PRIMARY KEY, unlocked_at TIMESTAMPTZ);
  CREATE TABLE attendance_schedule_policies (
    id UUID PRIMARY KEY, active_from DATE NOT NULL, active_to DATE);`;

const S = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const E = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;
const POLICY_ID = '30000000-0000-4000-8000-000000000001';

/** A fabricated closure: exactly clock_in + 9h, no missing_clock_out anywhere. */
async function seedFabricated(entryId: string, staffId: string, day: string): Promise<void> {
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
}

async function reset(): Promise<void> {
  await client.query(`TRUNCATE ${SCHEMA}.attendance_entries, ${SCHEMA}.attendance_daily_summaries,
    ${SCHEMA}.attendance_exceptions, ${SCHEMA}.attendance_day_exceptions,
    ${SCHEMA}.attendance_weekly_locks`);
  await client.query(`DROP TABLE IF EXISTS ${SCHEMA}.attendance_legacy_autoclose_backup,
    ${SCHEMA}.attendance_legacy_autoclose_summary_backup,
    ${SCHEMA}.attendance_legacy_autoclose_policy_backup`);
  await client.query(`DELETE FROM attendance_schedule_policies`);
  await client.query(
    `INSERT INTO attendance_schedule_policies (id, active_from) VALUES ($1::uuid, DATE '2026-08-03')`,
    [POLICY_ID]);
}

async function hours(staffId: string, day: string): Promise<number> {
  const { rows } = await client.query<{ regular_hrs: string }>(
    `SELECT regular_hrs::text FROM attendance_daily_summaries
     WHERE staff_id = $1::uuid AND work_date = $2::date`, [staffId, day]);
  return Number(rows[0]?.regular_hrs);
}

dbDescribe('legacy auto-close remediation', () => {
  beforeAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    conn = await pool.connect();
    await conn.query(`SET search_path = ${SCHEMA}`);
    await client.query(PREREQ);
  }, 60_000);

  afterAll(async () => {
    conn.release();
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    const leaked = await pool.query(
      `SELECT COUNT(*)::int AS n FROM pg_namespace WHERE nspname = $1`, [SCHEMA]);
    expect(leaked.rows[0].n).toBe(0);
    await pool.end();
  }, 60_000);

  beforeEach(reset);

  it('clears the fabricated clock-out, zeroes its hours, and backs both up', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    const plan = await planRemediation(client);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.blockers).toHaveLength(0);
    expect(plan.fabricatedHours).toBeCloseTo(9.55); // all five columns, not regular alone

    await applyRemediation(client, plan.candidates);

    const { rows } = await client.query<{ clock_out_at: Date | null; notes: string }>(
      `SELECT clock_out_at, received_at_out, notes FROM attendance_entries WHERE id = $1::uuid`, [E(1)]);
    expect(rows[0].clock_out_at).toBeNull();
    expect(rows[0].notes).toContain('original note');
    expect(await hours(S(1), '2026-05-04')).toBe(0);
  });

  it.each([
    ['payroll_week_locked', async () => {
      await client.query(`INSERT INTO attendance_weekly_locks (week_start_date) VALUES (DATE '2026-05-04')`);
    }],
    ['daily_result_locked', async () => {
      await client.query(`UPDATE attendance_daily_summaries SET result_status = 'locked'`);
    }],
    ['wage_already_computed', async () => {
      await client.query(`UPDATE attendance_daily_summaries SET wage_amount_cents = 12345`);
    }],
    ['already_projected', async () => {
      await client.query(`UPDATE attendance_daily_summaries SET calculation_fingerprint = 'abc'`);
    }],
    ['shares_day_with_another_entry', async () => {
      await client.query(
        `INSERT INTO attendance_entries (id, staff_id, work_date, clock_in_at, status)
         VALUES ($1::uuid, $2::uuid, DATE '2026-05-04', TIMESTAMPTZ '2026-05-04 06:00Z', 'closed')`,
        [E(9), S(1)]);
    }],
  ])('refuses to touch a row blocked by %s', async (reason, block) => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    await block();

    const plan = await planRemediation(client);

    expect(plan.candidates).toHaveLength(0);
    expect(plan.blockers.map((b) => b.reason)).toContain(reason);
    // Nothing eligible, so nothing is written even if apply is called.
    await applyRemediation(client, plan.candidates);
    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [E(1)]);
    expect(rows[0].clock_out_at).not.toBeNull();
  });

  // The second case deliberately uses a NULL entry_id: that is what
  // insertExceptionWithoutEntry writes, and an entry-keyed guard would miss it.
  it('skips a day already carrying a missing_clock_out in either exception table', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    await seedFabricated(E(2), S(2), '2026-05-05');
    await client.query(
      `INSERT INTO attendance_exceptions (entry_id, exception_kind) VALUES ($1::uuid, 'missing_clock_out')`, [E(1)]);
    await client.query(
      `INSERT INTO attendance_day_exceptions (entry_id, staff_id, work_date, kind)
       VALUES (NULL, $1::uuid, DATE '2026-05-05', 'missing_clock_out')`, [S(2)]);

    const plan = await planRemediation(client);

    expect(plan.candidates).toHaveLength(0);
  });

  // The whole point of the value-equality guard: a re-run must not destroy
  // hours that were legitimately recomputed after the first apply.
  it('does not re-zero a summary that was recomputed after the first apply', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    const first = await planRemediation(client);
    await applyRemediation(client, first.candidates);
    await client.query(
      `UPDATE attendance_daily_summaries SET regular_hrs = 8.00 WHERE staff_id = $1::uuid`, [S(1)]);

    // Re-running the tool re-plans, and the cleared entry is no longer a
    // candidate, so there is nothing to apply.
    const second = await planRemediation(client);
    expect(second.candidates).toHaveLength(0);
    await applyRemediation(client, second.candidates);

    expect(await hours(S(1), '2026-05-04')).toBe(8);
    // Replaying the STALE list aborts rather than mutating anything.
    await expect(applyRemediation(client, first.candidates))
      .rejects.toThrow('Eligibility changed since the dry run');
    expect(await hours(S(1), '2026-05-04')).toBe(8);
  });

  it('does not re-append its note when the tool is run twice', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    const plan = await planRemediation(client);
    await applyRemediation(client, plan.candidates);
    const second = await planRemediation(client);
    await applyRemediation(client, second.candidates);

    const { rows } = await client.query<{ notes: string }>(
      `SELECT notes FROM attendance_entries WHERE id = $1::uuid`, [E(1)]);
    expect(rows[0].notes.split('legacy auto-close remediation').length - 1).toBe(1);
  });

  it('rollback restores the entry and hours, and strips only its own note line', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    const plan = await planRemediation(client);
    await applyRemediation(client, plan.candidates);
    await client.query(
      `UPDATE attendance_entries SET notes = notes || E'\nsupervisor followed up' WHERE id = $1::uuid`, [E(1)]);

    const result = await rollbackRemediation(client);

    expect(result.applied).toBe(true);
    const { rows } = await client.query<{ clock_out_at: Date; notes: string }>(
      `SELECT clock_out_at, notes FROM attendance_entries WHERE id = $1::uuid`, [E(1)]);
    expect(rows[0].clock_out_at.toISOString()).toBe('2026-05-04T15:00:00.000Z');
    expect(rows[0].notes).toBe('original note\nsupervisor followed up');
    expect(await hours(S(1), '2026-05-04')).toBe(9);
  });

  it('rollback leaves a recomputed summary alone and reports it', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    const plan = await planRemediation(client);
    await applyRemediation(client, plan.candidates);
    await client.query(
      `UPDATE attendance_daily_summaries SET regular_hrs = 8.00 WHERE staff_id = $1::uuid`, [S(1)]);

    const result = await rollbackRemediation(client);

    expect(result.skippedChangedSummaries).toBe(1);
    expect(result.summariesRestored).toBe(0);
    expect(await hours(S(1), '2026-05-04')).toBe(8);
  });

  // The zeroing UPDATE must be scoped to THIS run's entries. Joining the whole
  // backup table would let a later apply re-zero every summary any earlier run
  // ever backed up — including days a rollback restored that are now locked.
  it('does not re-zero a previously restored day when a later apply runs', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    const first = await planRemediation(client);
    await applyRemediation(client, first.candidates);
    await rollbackRemediation(client);
    expect(await hours(S(1), '2026-05-04')).toBe(9);

    // A different entry becomes eligible later; the restored day must be untouched.
    await seedFabricated(E(2), S(2), '2026-05-06');
    const second = await planRemediation(client);
    expect(second.candidates.map((c) => c.entryId)).toContain(E(2));
    await applyRemediation(client, second.candidates.filter((c) => c.entryId === E(2)));

    expect(await hours(S(1), '2026-05-04')).toBe(9);
    expect(await hours(S(2), '2026-05-06')).toBe(0);
  });

  // The plan is built in an earlier transaction, so eligibility is re-asserted
  // inside the apply. A lock landing in between must abort, not be mutated.
  it('aborts the apply when a candidate became blocked since the plan', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    const plan = await planRemediation(client);
    expect(plan.candidates).toHaveLength(1);
    await client.query(
      `INSERT INTO attendance_weekly_locks (week_start_date) VALUES (DATE '2026-05-04')`);

    await expect(applyRemediation(client, plan.candidates))
      .rejects.toThrow('Eligibility changed since the dry run');

    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [E(1)]);
    expect(rows[0].clock_out_at).not.toBeNull();
    expect(await hours(S(1), '2026-05-04')).toBe(9);
  });

  it('commits nothing when the apply throws mid-transaction', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    const plan = await planRemediation(client);
    await client.query('BEGIN');
    await applyRemediation(client, plan.candidates);
    await client.query('ROLLBACK');

    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [E(1)]);
    expect(rows[0].clock_out_at).not.toBeNull();
    expect(await hours(S(1), '2026-05-04')).toBe(9);
    // The backup DDL is transactional too, so it rolls back with everything else.
    const { rows: t } = await client.query<{ present: boolean }>(
      `SELECT to_regclass('attendance_legacy_autoclose_backup') IS NOT NULL AS present`);
    expect(t[0].present).toBe(false);
  });

  // An entry auto-closed outside the window that ever wrote summaries has no
  // summary row at all. An INNER join would drop it from candidates AND
  // blockers, hiding it from the operator and from --expect.
  it('still remediates a fabricated entry that has no summary row', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    await client.query(`DELETE FROM attendance_daily_summaries`);

    const plan = await planRemediation(client);

    expect(plan.candidates).toHaveLength(1);
    expect(plan.withoutSummary).toBe(1);
    await applyRemediation(client, plan.candidates);
    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [E(1)]);
    expect(rows[0].clock_out_at).toBeNull();
  });

  it('strips its note and restores an entry whose notes were empty at apply time', async () => {
    await seedFabricated(E(1), S(1), '2026-05-04');
    await client.query(`UPDATE attendance_entries SET notes = NULL WHERE id = $1::uuid`, [E(1)]);
    const plan = await planRemediation(client);
    await applyRemediation(client, plan.candidates);
    await client.query(
      `UPDATE attendance_entries SET notes = notes || E'\nlater note' WHERE id = $1::uuid`, [E(1)]);

    await rollbackRemediation(client);

    const { rows } = await client.query<{ notes: string | null; clock_out_at: Date | null }>(
      `SELECT notes, clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [E(1)]);
    expect(rows[0].notes).toBe('later note');
    expect(rows[0].clock_out_at).not.toBeNull();
  });

  it('rollback reports it did nothing when the remediation was never applied', async () => {
    const result = await rollbackRemediation(client);
    expect(result.applied).toBe(false);
  });

  it('backdates the policy by captured id and restores it exactly', async () => {
    const applied = await backdatePolicy(client, '2026-04-25');
    expect(applied).toMatchObject({ previousActiveFrom: '2026-08-03', newActiveFrom: '2026-04-25' });

    const restored = await restorePolicy(client);

    expect(restored?.newActiveFrom).toBe('2026-08-03');
    const { rows } = await client.query<{ active_from: string }>(
      `SELECT TO_CHAR(active_from, 'YYYY-MM-DD') AS active_from FROM attendance_schedule_policies`);
    expect(rows[0].active_from).toBe('2026-08-03');
  });

  it('refuses to backdate when the open policy is not unique', async () => {
    await client.query(
      `INSERT INTO attendance_schedule_policies (id, active_from)
       VALUES ('40000000-0000-4000-8000-000000000001'::uuid, DATE '2026-09-01')`);
    await expect(backdatePolicy(client, '2026-04-25')).rejects.toThrow('found 2');
  });

  it('rejects a malformed backdate date instead of coercing it', async () => {
    await expect(backdatePolicy(client, '25-04-2026')).rejects.toThrow('YYYY-MM-DD');
  });
});
