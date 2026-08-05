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
 * by design (see employmentUniverse.ts: `attendance_tracked` scopes who is
 * *expected*, never who is *processed*, so an untracked person who does clock
 * in is still reconciled and still paid), so it will not learn to skip these.
 *
 * The asymmetry between the two rows is deliberate:
 *
 *   - The exception becomes `cancelled`, not deleted. That status is already a
 *     designed terminal state: projectionRepository.ts's upsert carries
 *     `WHEN status IN ('resolved','cancelled') THEN <keep existing>` on the
 *     ON CONFLICT (idempotency_key) path, so a cancelled exception survives a
 *     later reprojection untouched. Deleting it would be strictly worse — if HR
 *     opts that person in while the day is still inside the reconciler's
 *     trailing 14-day window, a deleted row is re-raised from scratch and the
 *     phantom returns, whereas a cancelled row stays withdrawn.
 *
 *   - The summary is deleted, because `attendance_daily_summaries.result_status`
 *     has no terminal non-blocking value. Every option other than `approved`
 *     and `locked` raises a blocker, and those two assert a payroll fact that
 *     nobody decided. Deleting is the only statement that does not lie.
 *
 * Deliberately NOT a migration. scripts/deploy-local-main.sh applies pending
 * migrations on every deploy against the single shared dev+prod database, so a
 * routine daytime dev deploy would withdraw production attendance rows
 * unattended. An operator runs this, in dry-run first, when they mean to.
 */

export interface RemediationClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export const WITHDRAWAL_ACTION = 'system_withdrawn';

export const EXCEPTION_REASON =
  'Withdrawn: staff member is not attendance_tracked (migration 479).';

export interface Candidate {
  exceptionId: string;
  staffId: string;
  workDate: string;
  previousStatus: string;
}

export interface Blocker {
  reason: string;
  staffId: string;
  workDate: string;
  exceptionId: string | null;
}

export interface WithdrawalPlan {
  candidates: Candidate[];
  blockers: Blocker[];
  staffCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * A withdrawable phantom is an unresolved exception whose staff member is not
 * attendance_tracked and for which no evidence of any kind exists.
 *
 * `kind` is not constrained here. missing_clock_in is what the pre-479 universe
 * actually produced, but any kind raised purely from an expectation is equally
 * stranded, and the evidence guards below are what make the row safe to
 * withdraw — not its label.
 *
 * Everything the blocker column flags is a row where withdrawing would discard
 * real evidence or cross a payroll lock. They are reported, never silently
 * skipped, so an operator sees the whole population and not just the easy part.
 */
const CANDIDATE_SQL = `
  SELECT x.id::text AS exception_id, x.staff_id::text AS staff_id,
         TO_CHAR(x.work_date, 'YYYY-MM-DD') AS work_date,
         x.status AS previous_status,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM attendance_weekly_locks wl
             WHERE wl.week_start_date = DATE_TRUNC('week', x.work_date)::date
               AND wl.unlocked_at IS NULL
           ) THEN 'payroll_week_locked'
           -- Any of the next four means a human or a device touched this day.
           -- The expectation may have been phantom; the evidence is not.
           WHEN x.entry_id IS NOT NULL THEN 'exception_cites_an_entry'
           WHEN x.adjustment_id IS NOT NULL THEN 'exception_cites_an_adjustment'
           WHEN EXISTS (
             SELECT 1 FROM attendance_entries e
             WHERE e.staff_id = x.staff_id AND e.work_date = x.work_date
           ) THEN 'staff_clocked_in_that_day'
           WHEN ds.staff_id IS NULL THEN 'no_summary_row'
           WHEN ds.result_status <> 'absence_review' THEN
             'summary_not_absence_review:' || ds.result_status
           WHEN ds.attendance_classification IS NOT NULL THEN 'already_classified'
           WHEN ds.approved_at IS NOT NULL THEN 'already_approved'
           ELSE NULL
         END AS blocker
  FROM attendance_day_exceptions x
  JOIN staff s ON s.id = x.staff_id
  -- LEFT, not INNER: an exception with no summary row must surface as a
  -- blocker the operator can see, not vanish from both sides of the report.
  LEFT JOIN attendance_daily_summaries ds
    ON ds.staff_id = x.staff_id AND ds.work_date = x.work_date
  WHERE s.attendance_tracked = false
    AND x.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')
    AND ($1::uuid[] IS NULL OR x.id = ANY($1::uuid[]))
  ORDER BY x.work_date, x.staff_id`;

interface CandidateRow extends Record<string, unknown> {
  exception_id: string;
  staff_id: string;
  work_date: string;
  previous_status: string;
  blocker: string | null;
}

async function selectCandidates(
  client: RemediationClient,
  ids: readonly string[] | null,
): Promise<{ candidates: Candidate[]; blockers: Blocker[] }> {
  const { rows } = await client.query<CandidateRow>(CANDIDATE_SQL, [ids]);
  const candidates: Candidate[] = [];
  const blockers: Blocker[] = [];
  for (const row of rows) {
    const base = { staffId: row.staff_id, workDate: row.work_date };
    if (row.blocker) {
      blockers.push({ ...base, reason: row.blocker, exceptionId: row.exception_id });
      continue;
    }
    candidates.push({
      ...base, exceptionId: row.exception_id, previousStatus: row.previous_status,
    });
  }
  return { candidates, blockers };
}

export async function planWithdrawal(client: RemediationClient): Promise<WithdrawalPlan> {
  const { candidates, blockers } = await selectCandidates(client, null);
  const staff = new Set(candidates.map((c) => c.staffId));
  const dates = candidates.map((c) => c.workDate).sort();
  return {
    candidates,
    blockers,
    staffCount: staff.size,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

export interface WithdrawalResult {
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
 * mutated.
 */
export async function applyWithdrawal(
  client: RemediationClient,
  candidates: readonly Candidate[],
): Promise<WithdrawalResult> {
  if (candidates.length === 0) {
    return {
      exceptionEventsWritten: 0, summaryEventsWritten: 0,
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
  // attendance_decision_events carries an immutability trigger that blocks
  // UPDATE/DELETE/TRUNCATE, so `before_value` is a stronger backup than any
  // table this role could create — fibreflow_user has no CREATE on schema
  // public. rollbackWithdrawal() restores straight out of it.
  const exceptionEventsWritten = await affected(client, `
    INSERT INTO attendance_decision_events (
      entity_type, entity_key, action, actor_user_id, actor_staff_id,
      reason, before_value, after_value)
    SELECT 'day_exception', x.id::text, $2::text, NULL, x.staff_id,
           $3::text,
           jsonb_build_object('status', x.status),
           jsonb_build_object('status', 'cancelled')
    FROM attendance_day_exceptions x
    WHERE x.id = ANY($1::uuid[])`, [ids, WITHDRAWAL_ACTION, EXCEPTION_REASON]);

  const summaryEventsWritten = await affected(client, `
    INSERT INTO attendance_decision_events (
      entity_type, entity_key, action, actor_user_id, actor_staff_id,
      reason, before_value, after_value)
    SELECT 'daily_result',
           ds.staff_id::text || ':' || TO_CHAR(ds.work_date, 'YYYY-MM-DD'),
           $2::text, NULL, ds.staff_id, $3::text,
           to_jsonb(ds),
           jsonb_build_object('deleted', true)
    FROM attendance_day_exceptions x
    JOIN attendance_daily_summaries ds
      ON ds.staff_id = x.staff_id AND ds.work_date = x.work_date
    WHERE x.id = ANY($1::uuid[])`, [
    ids, WITHDRAWAL_ACTION,
    'Phantom absence_review projection for an untracked staff member with zero entries; ' +
    "row deleted, verbatim copy retained in this event's before_value.",
  ]);

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

  // Scoped through THIS run's exception ids, and re-asserting absence_review so
  // a summary that gained real hours between the recheck and here is left alone
  // rather than deleted.
  const summariesDeleted = await affected(client, `
    DELETE FROM attendance_daily_summaries ds
    USING attendance_day_exceptions x
    WHERE x.id = ANY($1::uuid[])
      AND ds.staff_id = x.staff_id AND ds.work_date = x.work_date
      AND ds.result_status = 'absence_review'`, [ids]);

  return {
    exceptionEventsWritten, summaryEventsWritten, exceptionsCancelled, summariesDeleted,
  };
}

export interface RollbackResult {
  summariesRestored: number;
  exceptionsReopened: number;
}

/**
 * Reverses a withdrawal out of the audit trail.
 *
 * The events themselves are never deleted — the table forbids it, and the
 * history of "this was withdrawn, then restored" is worth more than a tidy
 * ledger. A restored day is therefore visible as a withdrawal event with no
 * matching phantom, which is exactly what happened.
 */
export async function rollbackWithdrawal(client: RemediationClient): Promise<RollbackResult> {
  const summariesRestored = await affected(client, `
    INSERT INTO attendance_daily_summaries
    SELECT (jsonb_populate_record(NULL::attendance_daily_summaries, e.before_value)).*
    FROM attendance_decision_events e
    WHERE e.entity_type = 'daily_result' AND e.action = $1::text
    ON CONFLICT (staff_id, work_date) DO NOTHING`, [WITHDRAWAL_ACTION]);

  // Only rows this remediation cancelled, identified by its own reason string,
  // so a genuine supervisor cancellation is never reopened.
  const exceptionsReopened = await affected(client, `
    UPDATE attendance_day_exceptions x
    SET status = COALESCE(e.before_value->>'status', 'awaiting_supervisor'),
        resolved_at = NULL, resolved_by = NULL, resolution_reason = NULL,
        updated_at = NOW()
    FROM attendance_decision_events e
    WHERE e.entity_type = 'day_exception' AND e.action = $1::text
      AND x.id::text = e.entity_key
      AND x.status = 'cancelled'
      AND x.resolution_reason = $2::text`, [WITHDRAWAL_ACTION, EXCEPTION_REASON]);

  return { summariesRestored, exceptionsReopened };
}

async function affected(
  client: RemediationClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const result = await client.query(text, values);
  return result.rowCount ?? 0;
}
