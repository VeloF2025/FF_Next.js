import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  applyRemediation, planRemediation,
} from '../../src/services/attendance/remediation/legacyAutocloseReset';
import { rollbackRemediation } from '../../src/services/attendance/remediation/legacyAutocloseRollback';
import { createHarness, ENTRY, STAFF } from './setup/autoclose-fixture';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DATABASE_URL ? describe : describe.skip;
const h = createHarness('autoclose_reset_scratch', DATABASE_URL);
const { client } = h;

dbDescribe('legacy auto-close remediation — plan and apply', () => {
  beforeAll(() => h.setup(), 60_000);
  afterAll(async () => expect(await h.teardown()).toBe(0), 60_000);
  beforeEach(() => h.reset());

  it('clears the fabricated clock-out, zeroes its hours, and backs both up', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    const plan = await planRemediation(client);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.blockers).toHaveLength(0);
    // regular + overtime. sunday/holiday/night OVERLAP those per migration 319,
    // so summing all five would double-count the same worked hours.
    expect(plan.fabricatedHours).toBe(9);

    await applyRemediation(client, plan.candidates);

    const { rows } = await client.query<{ clock_out_at: Date | null; notes: string }>(
      `SELECT clock_out_at, received_at_out, notes FROM attendance_entries WHERE id = $1::uuid`,
      [ENTRY(1)]);
    expect(rows[0].clock_out_at).toBeNull();
    expect(rows[0].notes).toContain('original note');
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(0);
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
        [ENTRY(9), STAFF(1)]);
    }],
  ])('refuses to touch a row blocked by %s', async (reason, block) => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    await block();

    const plan = await planRemediation(client);

    expect(plan.candidates).toHaveLength(0);
    expect(plan.blockers.map((b) => b.reason)).toContain(reason);
    await applyRemediation(client, plan.candidates);
    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [ENTRY(1)]);
    expect(rows[0].clock_out_at).not.toBeNull();
  });

  // The second case uses a NULL entry_id — what insertExceptionWithoutEntry
  // writes — which an entry-keyed guard would miss.
  it('skips a day already carrying a missing_clock_out in either exception table', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    await h.seedFabricated(ENTRY(2), STAFF(2), '2026-05-05');
    await client.query(
      `INSERT INTO attendance_exceptions (entry_id, exception_kind)
       VALUES ($1::uuid, 'missing_clock_out')`, [ENTRY(1)]);
    await client.query(
      `INSERT INTO attendance_day_exceptions (entry_id, staff_id, work_date, kind)
       VALUES (NULL, $1::uuid, DATE '2026-05-05', 'missing_clock_out')`, [STAFF(2)]);

    expect((await planRemediation(client)).candidates).toHaveLength(0);
  });

  it('does not re-zero a summary that was recomputed after the first apply', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    const first = await planRemediation(client);
    await applyRemediation(client, first.candidates);
    await client.query(
      `UPDATE attendance_daily_summaries SET regular_hrs = 8.00 WHERE staff_id = $1::uuid`, [STAFF(1)]);

    // Re-running the tool re-plans; the cleared entry is no longer a candidate.
    const second = await planRemediation(client);
    expect(second.candidates).toHaveLength(0);
    await applyRemediation(client, second.candidates);
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(8);

    // Replaying the STALE list aborts rather than mutating anything.
    await expect(applyRemediation(client, first.candidates))
      .rejects.toThrow('Eligibility changed since the dry run');
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(8);
  });

  it('does not re-append its note when the tool is run twice', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    await applyRemediation(client, (await planRemediation(client)).candidates);
    await applyRemediation(client, (await planRemediation(client)).candidates);

    const { rows } = await client.query<{ notes: string }>(
      `SELECT notes FROM attendance_entries WHERE id = $1::uuid`, [ENTRY(1)]);
    expect(rows[0].notes.split('legacy auto-close remediation').length - 1).toBe(1);
  });

  // The zeroing UPDATE must be scoped to THIS run's entries. Joining the whole
  // backup table would let a later apply re-zero every summary any earlier run
  // backed up — including days a rollback restored that are now locked.
  it('does not re-zero a previously restored day when a later apply runs', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    await applyRemediation(client, (await planRemediation(client)).candidates);
    await rollbackRemediation(client);
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(9);

    await h.seedFabricated(ENTRY(2), STAFF(2), '2026-05-06');
    const second = await planRemediation(client);
    expect(second.candidates.map((c) => c.entryId)).toContain(ENTRY(2));
    await applyRemediation(client, second.candidates.filter((c) => c.entryId === ENTRY(2)));

    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(9);
    expect(await h.hours(STAFF(2), '2026-05-06')).toBe(0);
  });

  // The plan is built in an earlier transaction, so eligibility is re-asserted
  // inside the apply. A lock landing in between must abort, not be mutated.
  it('aborts the apply when a candidate became blocked since the plan', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    const plan = await planRemediation(client);
    await client.query(
      `INSERT INTO attendance_weekly_locks (week_start_date) VALUES (DATE '2026-05-04')`);

    await expect(applyRemediation(client, plan.candidates))
      .rejects.toThrow('Eligibility changed since the dry run');

    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [ENTRY(1)]);
    expect(rows[0].clock_out_at).not.toBeNull();
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(9);
  });

  it('commits nothing when the apply aborts mid-transaction', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    const plan = await planRemediation(client);
    await client.query('BEGIN');
    try {
      await applyRemediation(client, plan.candidates);
      // A genuine failure AFTER the mutations, so this is a real abort rather
      // than an explicit ROLLBACK of a successful apply.
      await client.query('SELECT 1 / 0');
    } catch {
      // expected
    } finally {
      // Always leave the shared connection usable — an aborted transaction here
      // would fail every later test with 25P02, turning one failure into a cascade.
      await client.query('ROLLBACK');
    }

    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [ENTRY(1)]);
    expect(rows[0].clock_out_at).not.toBeNull();
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(9);
    const { rows: t } = await client.query<{ present: boolean }>(
      `SELECT to_regclass('attendance_legacy_autoclose_backup') IS NOT NULL AS present`);
    expect(t[0].present).toBe(false);
  });

  // An entry auto-closed outside the window that ever wrote summaries has no
  // summary row. An INNER join would drop it from candidates AND blockers.
  it('still remediates a fabricated entry that has no summary row', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    await client.query(`DELETE FROM attendance_daily_summaries`);

    const plan = await planRemediation(client);

    expect(plan.candidates).toHaveLength(1);
    expect(plan.withoutSummary).toBe(1);
    await applyRemediation(client, plan.candidates);
    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [ENTRY(1)]);
    expect(rows[0].clock_out_at).toBeNull();
  });
});
