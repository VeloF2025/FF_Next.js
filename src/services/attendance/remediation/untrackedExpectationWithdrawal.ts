/**
 * Remediation for attendance expectations stranded by an opt-out.
 *
 * Before migration 479 the reconciler projected `staff CROSS JOIN workdays`
 * with no opt-in filter, so every employed staff member was expected to clock
 * in every Mon-Sat. 479 added `staff.attendance_tracked` and filtered all five
 * expectation CTEs by it — but it could not retract the rows the old universe
 * had already written.
 *
 * Those rows are unreachable. `buildCandidates()` is `expected ∪ entries`, so a
 * (staff, day) that is neither expected nor backed by an entry is never
 * reprojected: nothing updates it, nothing resolves it, and the exception sits
 * in a supervisor queue indefinitely.
 *
 * TWO rows per phantom, and both must go. Cancelling only the exception makes
 * `blockersSql()`'s row-driven `unapproved_<status>` CTE raise the paired
 * absence_review summary as a blocker instead — the same week stays unlockable,
 * just under a different label. That CTE keys on `employmentEffectivePredicate`
 * by design (employmentUniverse.ts: `attendance_tracked` scopes who is
 * *expected*, never who is *processed*), so it will not learn to skip these.
 *
 * The asymmetry between the two rows is deliberate. The exception becomes
 * `cancelled` rather than deleted, because projectionRepository.ts's upsert
 * carries `WHEN status IN ('resolved','cancelled') THEN <keep existing>` on the
 * ON CONFLICT (idempotency_key) path — so a cancelled row stays withdrawn,
 * whereas a deleted one is re-raised from scratch if HR opts that person back in
 * while the day is still inside the reconciler's trailing 14-day window. The
 * summary is deleted, because `result_status` has no terminal non-blocking
 * value: everything but `approved`/`locked` blocks, and those two assert a
 * payroll fact nobody decided.
 *
 * Deliberately NOT a migration. scripts/deploy-local-main.sh applies pending
 * migrations on every deploy against the single shared dev+prod database, so a
 * routine daytime dev deploy would withdraw production attendance rows
 * unattended. An operator runs this, in dry-run first, when they mean to.
 *
 * Candidate selection: ./untrackedExpectationWithdrawalCandidates.ts
 * Reverse half:        ./untrackedExpectationWithdrawalRollback.ts
 */

import { randomUUID } from 'crypto';

import {
  selectCandidates, summaryKeys,
  type Candidate, type RemediationClient,
} from './untrackedExpectationWithdrawalCandidates';

export {
  candidateDigest, planWithdrawal, selectCandidates, summaryKeys,
  type Blocker, type Candidate, type RemediationClient, type WithdrawalPlan,
} from './untrackedExpectationWithdrawalCandidates';

export const WITHDRAWAL_ACTION = 'system_withdrawn';

export const EXCEPTION_REASON =
  'Withdrawn: staff member is not attendance_tracked (migration 479).';

const SUMMARY_REASON =
  'Phantom absence_review projection for an untracked staff member with zero entries; ' +
  "row deleted, verbatim copy retained in this event's before_value.";

export interface WithdrawalResult {
  runId: string;
  exceptionEventsWritten: number;
  summaryEventsWritten: number;
  exceptionsCancelled: number;
  summariesDeleted: number;
}

/**
 * Caller supplies the transaction.
 *
 * Every statement is driven by the explicit candidate id list rather than by
 * re-running the predicate, so what a dry-run showed is exactly what gets
 * mutated. `runId` is stamped into both audit events so a later rollback can be
 * scoped to THIS apply rather than to the tool's entire history.
 */
export async function applyWithdrawal(
  client: RemediationClient,
  candidates: readonly Candidate[],
  runId: string = randomUUID(),
): Promise<WithdrawalResult> {
  if (candidates.length === 0) {
    return {
      runId, exceptionEventsWritten: 0, summaryEventsWritten: 0,
      exceptionsCancelled: 0, summariesDeleted: 0,
    };
  }
  const ids = candidates.map((c) => c.exceptionId);

  // The plan was built in an earlier, separate transaction. A weekly lock, a
  // late clock-in, a supervisor decision or an HR opt-in can land in between,
  // so eligibility is re-asserted here, inside the caller's transaction,
  // against the same predicate. Anything that moved aborts the whole apply
  // rather than being quietly withdrawn.
  const recheck = await selectCandidates(client, ids);
  if (recheck.candidates.length !== ids.length || recheck.blockers.length > 0) {
    const reasons = [...new Set(recheck.blockers.map((b) => b.reason))].sort().join(', ');
    throw new Error(
      `Eligibility changed since the dry run: ${recheck.candidates.length}/${ids.length} still eligible` +
      (reasons ? ` (now blocked by: ${reasons})` : '') + '. Re-run the dry run.',
    );
  }

  // Audit BEFORE mutating, and audit the summary as a whole row.
  //
  // actor_user_id is NULL because no user decided this — it is a system
  // correction. actor_staff_id deliberately carries the SUBJECT (whose row was
  // withdrawn), not an actor: it keeps the events filterable per staff member,
  // and there is no actor to name. Read it as "whose row", not "who did it".
  const exceptionEventsWritten = await affected(client, `
    INSERT INTO attendance_decision_events (
      entity_type, entity_key, action, actor_user_id, actor_staff_id,
      reason, before_value, after_value)
    SELECT 'day_exception', x.id::text, $2::text, NULL::uuid, x.staff_id, $3::text,
           jsonb_build_object('status', x.status),
           jsonb_build_object('status', 'cancelled', 'runId', $4::text)
    FROM attendance_day_exceptions x
    WHERE x.id = ANY($1::uuid[])`, [ids, WITHDRAWAL_ACTION, EXCEPTION_REASON, runId]);

  // DISTINCT: two exceptions can share one (staff, day) and therefore one
  // summary row. Without it that row would be audited twice and the counts
  // below would diverge for a reason that is not drift.
  const summaryEventsWritten = await affected(client, `
    INSERT INTO attendance_decision_events (
      entity_type, entity_key, action, actor_user_id, actor_staff_id,
      reason, before_value, after_value)
    SELECT DISTINCT 'daily_result',
           ds.staff_id::text || ':' || TO_CHAR(ds.work_date, 'YYYY-MM-DD'),
           $2::text, NULL::uuid, ds.staff_id, $3::text, to_jsonb(ds),
           jsonb_build_object('deleted', true, 'runId', $4::text)
    FROM attendance_day_exceptions x
    JOIN attendance_daily_summaries ds
      ON ds.staff_id = x.staff_id AND ds.work_date = x.work_date
    WHERE x.id = ANY($1::uuid[])`, [ids, WITHDRAWAL_ACTION, SUMMARY_REASON, runId]);

  // resolved_by stays NULL: no user decided this, and the column is a FK to
  // users. The status guard keeps a concurrent supervisor decision from being
  // overwritten even though the recheck above already holds the row's premise.
  const exceptionsCancelled = await affected(client, `
    UPDATE attendance_day_exceptions x
    SET status = 'cancelled', resolved_at = NOW(), resolved_by = NULL,
        resolution_reason = $2::text, updated_at = NOW()
    WHERE x.id = ANY($1::uuid[])
      AND x.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')`,
  [ids, EXCEPTION_REASON]);

  // Scoped through THIS run's ids, re-asserting absence_review so a summary that
  // gained real hours since the recheck is left alone rather than deleted.
  const summariesDeleted = await affected(client, `
    DELETE FROM attendance_daily_summaries ds
    USING attendance_day_exceptions x
    WHERE x.id = ANY($1::uuid[])
      AND ds.staff_id = x.staff_id AND ds.work_date = x.work_date
      AND ds.result_status = 'absence_review'`, [ids]);

  assertConsistent({
    ids: ids.length, summaries: summaryKeys(candidates).length,
    exceptionEventsWritten, summaryEventsWritten, exceptionsCancelled, summariesDeleted,
  });

  return {
    runId, exceptionEventsWritten, summaryEventsWritten, exceptionsCancelled, summariesDeleted,
  };
}

/**
 * The pair is the whole point: every candidate has an absence_review summary
 * (`no_summary_row` is a blocker), so the exception-side counts must equal the
 * candidate count and the summary-side counts must equal the distinct (staff,
 * day) count. Divergence means the tables were left inconsistent — an exception
 * cancelled with its summary still present, or an audit event describing a
 * deletion that did not happen.
 *
 * This also converts the residual READ COMMITTED window into an abort: the
 * recheck takes no row locks, so a commit landing between it and the mutating
 * statements is not blocked, but it would make one statement match fewer rows
 * than the others — which now rolls the caller back instead of half-applying.
 */
function assertConsistent(n: {
  ids: number; summaries: number; exceptionEventsWritten: number;
  summaryEventsWritten: number; exceptionsCancelled: number; summariesDeleted: number;
}): void {
  const ok = n.exceptionEventsWritten === n.ids && n.exceptionsCancelled === n.ids
    && n.summaryEventsWritten === n.summaries && n.summariesDeleted === n.summaries;
  if (ok) return;
  throw new Error(
    `Withdrawal left the pair inconsistent and was rolled back: ${n.ids} candidates over ` +
    `${n.summaries} days -> ${n.exceptionEventsWritten} exception events, ` +
    `${n.summaryEventsWritten} summary events, ${n.exceptionsCancelled} cancelled, ` +
    `${n.summariesDeleted} deleted. The data changed underneath the run — re-run the dry run.`,
  );
}

async function affected(
  client: RemediationClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const result = await client.query(text, values);
  return result.rowCount ?? 0;
}
