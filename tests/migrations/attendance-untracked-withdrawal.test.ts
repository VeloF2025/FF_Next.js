import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EXCEPTION_REASON, applyWithdrawal, planWithdrawal, rollbackWithdrawal,
} from '../../src/services/attendance/remediation/untrackedExpectationWithdrawal';
import {
  ADJUSTMENT, ENTRY, EXC, STAFF, createHarness,
} from './setup/untracked-withdrawal-fixture';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DATABASE_URL ? describe : describe.skip;
const h = createHarness('untracked_withdrawal_scratch', DATABASE_URL);
const { client } = h;

const DAY = '2026-08-04';

dbDescribe('untracked-expectation withdrawal', () => {
  beforeAll(() => h.setup(), 60_000);
  afterAll(async () => expect(await h.teardown()).toBe(0), 60_000);
  beforeEach(() => h.reset());

  it('cancels the exception, deletes the phantom summary, and audits both', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const before = await h.summaryJson(STAFF(1), DAY);

    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.blockers).toHaveLength(0);
    expect(plan.staffCount).toBe(1);
    expect(plan.firstDate).toBe(DAY);

    const result = await applyWithdrawal(client, plan.candidates);
    expect(result).toEqual({
      exceptionEventsWritten: 1, summaryEventsWritten: 1,
      exceptionsCancelled: 1, summariesDeleted: 1,
    });

    const exc = await h.exception(EXC(1));
    expect(exc?.status).toBe('cancelled');
    expect(exc?.resolution_reason).toBe(EXCEPTION_REASON);
    // No user decided this, and the column is a FK to users.
    expect(exc?.resolved_by).toBeNull();
    expect(await h.summaryJson(STAFF(1), DAY)).toBeUndefined();

    // The audit row must hold the deleted summary verbatim — it is the only
    // backup, so a partial capture would make the rollback lossy.
    const summaryEvents = await h.events('daily_result');
    expect(summaryEvents).toHaveLength(1);
    expect(summaryEvents[0].entity_key).toBe(`${STAFF(1)}:${DAY}`);
    expect(summaryEvents[0].before_value).toEqual(before);
    expect(summaryEvents[0].after_value).toEqual({ deleted: true });

    const exceptionEvents = await h.events('day_exception');
    expect(exceptionEvents[0].before_value).toEqual({ status: 'awaiting_supervisor' });
    expect(exceptionEvents[0].after_value).toEqual({ status: 'cancelled' });
  });

  it('leaves attendance_tracked staff completely alone', async () => {
    await h.seedStaff(STAFF(2), true);
    await h.seedPhantom(EXC(2), STAFF(2), DAY);

    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(0);
    // Not even reported as blocked: a tracked staff member's exception is a
    // real one the reconciler will keep maintaining.
    expect(plan.blockers).toHaveLength(0);
  });

  it.each([
    ['payroll_week_locked', async () => {
      await client.query(
        `INSERT INTO attendance_weekly_locks (week_start_date) VALUES (DATE '2026-08-03')`);
    }],
    ['exception_cites_an_entry', async () => {
      await client.query(`UPDATE attendance_day_exceptions SET entry_id = $1::uuid`, [ENTRY(1)]);
    }],
    ['exception_cites_an_adjustment', async () => {
      await client.query(
        `UPDATE attendance_day_exceptions SET adjustment_id = $1::uuid`, [ADJUSTMENT(1)]);
    }],
    ['staff_clocked_in_that_day', async () => {
      await client.query(
        `INSERT INTO attendance_entries (id, staff_id, work_date, clock_in_at, status)
         VALUES ($1::uuid, $2::uuid, $3::date, ($3 || ' 06:00Z')::timestamptz, 'closed')`,
        [ENTRY(2), STAFF(1), DAY]);
    }],
    ['already_classified', async () => {
      await client.query(
        `UPDATE attendance_daily_summaries SET attendance_classification = 'sick_leave'`);
    }],
    ['already_approved', async () => {
      await client.query(`UPDATE attendance_daily_summaries SET approved_at = NOW()`);
    }],
    ['no_summary_row', async () => {
      await client.query(`DELETE FROM attendance_daily_summaries`);
    }],
  ])('refuses to withdraw a row blocked by %s', async (reason, block) => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    await block();

    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.blockers.map((b) => b.reason)).toEqual([reason]);

    // Reported, never silently skipped: the operator sees the whole population.
    expect(plan.blockers[0].exceptionId).toBe(EXC(1));
    expect((await h.exception(EXC(1)))?.status).toBe('awaiting_supervisor');
  });

  it('reports a summary that is no longer absence_review, with its status', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    await client.query(`UPDATE attendance_daily_summaries SET result_status = 'provisional'`);

    const plan = await planWithdrawal(client);
    expect(plan.blockers.map((b) => b.reason)).toEqual(['summary_not_absence_review:provisional']);
  });

  it.each(['resolved', 'cancelled'])('ignores an already-%s exception', async (status) => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    await client.query(`UPDATE attendance_day_exceptions SET status = $1`, [status]);

    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.blockers).toHaveLength(0);
  });

  it('aborts the apply when eligibility drifted since the dry run', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const plan = await planWithdrawal(client);

    // The worker clocked in late, after the operator looked but before they applied.
    await client.query(
      `INSERT INTO attendance_entries (id, staff_id, work_date, clock_in_at, status)
       VALUES ($1::uuid, $2::uuid, $3::date, ($3 || ' 06:00Z')::timestamptz, 'closed')`,
      [ENTRY(2), STAFF(1), DAY]);

    await expect(applyWithdrawal(client, plan.candidates))
      .rejects.toThrow(/Eligibility changed.*staff_clocked_in_that_day/s);
    expect((await h.exception(EXC(1)))?.status).toBe('awaiting_supervisor');
    expect(await h.summaryJson(STAFF(1), DAY)).toBeDefined();
  });

  it('aborts the apply when the staff member was opted back in since the dry run', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const plan = await planWithdrawal(client);

    await h.seedStaff(STAFF(1), true);

    // An opt-in drops the row out of the predicate entirely rather than
    // blocking it, so the count check — not the blocker list — is what catches
    // this. Both halves of the guard matter.
    await expect(applyWithdrawal(client, plan.candidates))
      .rejects.toThrow(/0\/1 still eligible/);
    expect((await h.exception(EXC(1)))?.status).toBe('awaiting_supervisor');
  });

  it('restores the summary byte-exact and reopens the exception on rollback', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const before = await h.summaryJson(STAFF(1), DAY);

    const plan = await planWithdrawal(client);
    await applyWithdrawal(client, plan.candidates);
    expect(await h.summaryJson(STAFF(1), DAY)).toBeUndefined();

    const rolled = await rollbackWithdrawal(client);
    expect(rolled).toEqual({ summariesRestored: 1, exceptionsReopened: 1 });
    expect(await h.summaryJson(STAFF(1), DAY)).toEqual(before);

    const exc = await h.exception(EXC(1));
    expect(exc?.status).toBe('awaiting_supervisor');
    expect(exc?.resolution_reason).toBeNull();
    expect(exc?.resolved_at).toBeNull();

    // The audit trail survives the rollback. "Withdrawn, then restored" is the
    // truth, and the table's trigger would abort a run that tried to tidy it.
    expect(await h.events('daily_result')).toHaveLength(1);
    expect(await h.events('day_exception')).toHaveLength(1);
  });

  it('does not reopen an exception a supervisor cancelled', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const plan = await planWithdrawal(client);
    await applyWithdrawal(client, plan.candidates);

    // A human later re-cancels the same row for their own reason.
    await client.query(
      `UPDATE attendance_day_exceptions SET resolution_reason = 'cancelled by HR'`);

    const rolled = await rollbackWithdrawal(client);
    expect(rolled.exceptionsReopened).toBe(0);
    expect((await h.exception(EXC(1)))?.status).toBe('cancelled');
  });

  it('withdraws nothing and writes nothing when there is nothing to withdraw', async () => {
    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.firstDate).toBeNull();

    expect(await applyWithdrawal(client, plan.candidates)).toEqual({
      exceptionEventsWritten: 0, summaryEventsWritten: 0,
      exceptionsCancelled: 0, summariesDeleted: 0,
    });
    expect(await h.events('day_exception')).toHaveLength(0);
  });
});
