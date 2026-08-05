import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EXCEPTION_REASON, applyWithdrawal, candidateDigest, planWithdrawal,
} from '../../src/services/attendance/remediation/untrackedExpectationWithdrawal';
import {
  LEGACY_RUN_ID, latestRunId, rollbackWithdrawal,
} from '../../src/services/attendance/remediation/untrackedExpectationWithdrawalRollback';
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
    expect(result).toMatchObject({
      exceptionEventsWritten: 1, summaryEventsWritten: 1,
      exceptionsCancelled: 1, summariesDeleted: 1,
    });
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);

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
    expect(summaryEvents[0].after_value).toEqual({ deleted: true, runId: result.runId });

    const exceptionEvents = await h.events('day_exception');
    expect(exceptionEvents[0].before_value).toEqual({ status: 'awaiting_supervisor' });
    expect(exceptionEvents[0].after_value).toEqual({ status: 'cancelled', runId: result.runId });
    expect(await latestRunId(client)).toBe(result.runId);
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

  /**
   * result_status is NULLable in production and is in fact NULL for the large
   * majority of rows. `NULL <> 'absence_review'` yields NULL, not TRUE, so a
   * plain <> lets the row fall through the CASE and be reported as
   * withdrawable — while the DELETE's `= 'absence_review'` never matches it.
   * That combination cancels the exception and writes an audit event claiming
   * a deletion that did not happen. The predicate must use IS DISTINCT FROM.
   */
  it('blocks — does not withdraw — a summary whose result_status is NULL', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    await client.query(`UPDATE attendance_daily_summaries SET result_status = NULL`);

    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.blockers.map((b) => b.reason)).toEqual(['summary_not_absence_review:null']);

    // And the row survives untouched.
    expect((await h.exception(EXC(1)))?.status).toBe('awaiting_supervisor');
    expect(await h.summaryJson(STAFF(1), DAY)).toBeDefined();
  });

  it('aborts rather than half-applying if the pair diverges mid-transaction', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    await h.seedStaff(STAFF(2), false);
    await h.seedPhantom(EXC(2), STAFF(2), DAY);
    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(2);

    // A change made BEFORE the call is caught by the in-transaction recheck —
    // that path is covered by the two "aborts the apply when …" specs above.
    // The consistency guard exists for the narrower window the recheck cannot
    // close: it takes no row locks, so a commit landing between the recheck and
    // the mutating statements is not blocked. A trigger reproduces exactly that
    // ordering deterministically — it fires during the cancel UPDATE, after the
    // recheck has already passed, and makes the DELETE match 1 row where the
    // cancel matched 2.
    await client.query(`
      CREATE FUNCTION divergence_probe() RETURNS TRIGGER AS $fn$
      BEGIN
        UPDATE attendance_daily_summaries SET result_status = NULL
        WHERE staff_id = NEW.staff_id AND work_date = NEW.work_date
          AND NEW.staff_id = '${STAFF(2)}'::uuid;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
      CREATE TRIGGER divergence_probe_trg
        BEFORE UPDATE ON attendance_day_exceptions
        FOR EACH ROW EXECUTE FUNCTION divergence_probe();`);
    try {
      await expect(applyWithdrawal(client, plan.candidates))
        .rejects.toThrow(/left the pair inconsistent.*2 cancelled, 1 deleted/s);
    } finally {
      await client.query(`DROP TRIGGER divergence_probe_trg ON attendance_day_exceptions`);
      await client.query(`DROP FUNCTION divergence_probe()`);
    }
  });

  it('does not reopen an exception whose summary was not restored', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const plan = await planWithdrawal(client);
    await applyWithdrawal(client, plan.candidates);

    // The staff member is opted back in and the reconciler writes a fresh,
    // legitimate summary for the same day. The restore must not clobber it —
    // and the exception must therefore NOT be reopened next to it.
    await h.seedStaff(STAFF(1), true);
    await client.query(
      `INSERT INTO attendance_daily_summaries (staff_id, work_date, scheduled_paid_hrs, result_status)
       VALUES ($1::uuid, $2::date, 8.00, 'approved')`, [STAFF(1), DAY]);

    const rolled = await rollbackWithdrawal(client);
    expect(rolled).toMatchObject({ summariesRestored: 0, exceptionsReopened: 0 });
    expect((await h.exception(EXC(1)))?.status).toBe('cancelled');
    expect((await h.summaryJson(STAFF(1), DAY))?.result_status).toBe('approved');
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
    expect(rolled).toMatchObject({ summariesRestored: 1, exceptionsReopened: 1 });
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

  /**
   * The dry run and the apply are separate process invocations that each
   * re-plan from scratch, so a count alone cannot detect a same-size,
   * different-membership substitution between the two.
   */
  it('digests differently when membership changes at an identical count', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const before = await planWithdrawal(client);
    expect(before.candidates).toHaveLength(1);

    // One candidate out, a different one in — count unchanged.
    await client.query(`UPDATE attendance_day_exceptions SET status = 'resolved'`);
    await h.seedStaff(STAFF(3), false);
    await h.seedPhantom(EXC(3), STAFF(3), DAY);
    const after = await planWithdrawal(client);

    expect(after.candidates).toHaveLength(before.candidates.length);
    expect(after.digest).not.toBe(before.digest);
    expect(candidateDigest(after.candidates)).toBe(after.digest);
  });

  it('rolls back only the targeted run, leaving an earlier run withdrawn', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const runA = await applyWithdrawal(client, (await planWithdrawal(client)).candidates);

    await h.seedStaff(STAFF(2), false);
    await h.seedPhantom(EXC(2), STAFF(2), '2026-08-05');
    const runB = await applyWithdrawal(client, (await planWithdrawal(client)).candidates);
    expect(runB.runId).not.toBe(runA.runId);

    const rolled = await rollbackWithdrawal(client, runB.runId);
    expect(rolled).toMatchObject({
      runId: runB.runId, summariesRestored: 1, exceptionsReopened: 1,
    });

    // B is back; A is untouched — the whole point of run scoping.
    expect((await h.exception(EXC(2)))?.status).toBe('awaiting_supervisor');
    expect((await h.exception(EXC(1)))?.status).toBe('cancelled');
    expect(await h.summaryJson(STAFF(1), DAY)).toBeUndefined();
  });

  /**
   * The original 53 phantoms were withdrawn by one-off SQL that predates run
   * stamping, and attendance_decision_events is append-only so those events can
   * never be given a runId. They must stay reversible.
   */
  it('reverses un-stamped legacy events under the legacy run id', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const before = await h.summaryJson(STAFF(1), DAY);
    await h.withdrawWithoutRunId(EXC(1), STAFF(1), DAY);
    expect(await h.summaryJson(STAFF(1), DAY)).toBeUndefined();

    expect(await latestRunId(client)).toBe(LEGACY_RUN_ID);
    const rolled = await rollbackWithdrawal(client, LEGACY_RUN_ID);
    expect(rolled).toMatchObject({
      runId: LEGACY_RUN_ID, summariesRestored: 1, exceptionsReopened: 1,
    });
    expect(await h.summaryJson(STAFF(1), DAY)).toEqual(before);
    expect((await h.exception(EXC(1)))?.status).toBe('awaiting_supervisor');
  });

  it('refuses to restore when the table gained a column since the withdrawal', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    const run = await applyWithdrawal(client, (await planWithdrawal(client)).candidates);

    // A migration lands between the withdrawal and the rollback.
    // jsonb_populate_record would silently write NULL into the new column.
    await client.query(`ALTER TABLE attendance_daily_summaries ADD COLUMN wage_amount_cents BIGINT`);
    try {
      await expect(rollbackWithdrawal(client, run.runId))
        .rejects.toThrow(/gained column\(s\).*wage_amount_cents/s);
      expect(await h.summaryJson(STAFF(1), DAY)).toBeUndefined();
    } finally {
      await client.query(`ALTER TABLE attendance_daily_summaries DROP COLUMN wage_amount_cents`);
    }
  });

  /**
   * Two open exceptions can legitimately share one (staff, day) — different
   * `kind`s — and they share ONE summary row. The summary-side counts must
   * therefore compare against distinct staff-days, not the exception count, and
   * both the audit INSERT and the rollback restore must dedupe. Without the
   * DISTINCTs this either trips the consistency guard spuriously or hits
   * "ON CONFLICT DO NOTHING cannot affect row a second time".
   */
  it('handles two exceptions sharing one summary day, in both directions', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    await h.seedPhantom(EXC(4), STAFF(1), DAY); // same day: summary INSERT is a no-op

    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(2);
    expect(plan.summaryCount).toBe(1);

    const result = await applyWithdrawal(client, plan.candidates);
    expect(result).toMatchObject({
      exceptionEventsWritten: 2, summaryEventsWritten: 1,
      exceptionsCancelled: 2, summariesDeleted: 1,
    });
    expect(await h.summaryJson(STAFF(1), DAY)).toBeUndefined();

    const rolled = await rollbackWithdrawal(client, result.runId);
    expect(rolled).toMatchObject({ summariesRestored: 1, exceptionsReopened: 2 });
    expect((await h.exception(EXC(1)))?.status).toBe('awaiting_supervisor');
    expect((await h.exception(EXC(4)))?.status).toBe('awaiting_supervisor');
  });

  /**
   * The apply path dedupes summary events, so within one run a key appears
   * once. The LEGACY bucket has no such guarantee: the original one-off SQL
   * wrote one summary event per exception row, so two co-dated exceptions left
   * two events under the same entity_key, all sharing the single `legacy` run
   * id. ON CONFLICT DO NOTHING tolerates that (it is DO UPDATE that errors), so
   * the risk is not a crash but an arbitrary winner — the rollback must restore
   * the NEWEST recorded state, deterministically.
   */
  it('restores the newest event when the legacy bucket holds duplicates for one day', async () => {
    await h.seedStaff(STAFF(1), false);
    await h.seedPhantom(EXC(1), STAFF(1), DAY);
    await h.withdrawWithoutRunId(EXC(1), STAFF(1), DAY);

    // A second, LATER event for the same key holding a different payload —
    // the shape a co-dated exception would have produced.
    await client.query(
      `INSERT INTO attendance_decision_events (entity_type, entity_key, action,
         actor_staff_id, reason, before_value, after_value, recorded_at)
       SELECT entity_type, entity_key, action, actor_staff_id, reason,
              jsonb_set(before_value, '{scheduled_paid_hrs}', '"9.99"'),
              after_value, recorded_at + INTERVAL '1 minute'
       FROM attendance_decision_events WHERE entity_type = 'daily_result'`);
    expect(await h.events('daily_result')).toHaveLength(2);

    const rolled = await rollbackWithdrawal(client, LEGACY_RUN_ID);
    expect(rolled).toMatchObject({ summariesRestored: 1, exceptionsReopened: 1 });
    // Exactly one row back, carrying the newer payload — not the older one.
    // to_jsonb renders NUMERIC as a JSON number, so this comes back unquoted.
    expect(Number((await h.summaryJson(STAFF(1), DAY))?.scheduled_paid_hrs)).toBe(9.99);
  });

  it('reports nothing to restore for an unknown run, instead of false schema drift', async () => {
    // The schema-drift guard compares the stored payload's keys against the live
    // table. An unknown run has no payload at all, so a naive EXCEPT would
    // report every column as newly added and refuse a rollback that simply has
    // nothing to do.
    const rolled = await rollbackWithdrawal(client, '00000000-0000-4000-8000-000000000000');
    expect(rolled).toMatchObject({ summariesRestored: 0, exceptionsReopened: 0 });
  });

  it('withdraws nothing and writes nothing when there is nothing to withdraw', async () => {
    const plan = await planWithdrawal(client);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.firstDate).toBeNull();

    expect(await applyWithdrawal(client, plan.candidates)).toMatchObject({
      exceptionEventsWritten: 0, summaryEventsWritten: 0,
      exceptionsCancelled: 0, summariesDeleted: 0,
    });
    expect(await h.events('day_exception')).toHaveLength(0);
  });
});
