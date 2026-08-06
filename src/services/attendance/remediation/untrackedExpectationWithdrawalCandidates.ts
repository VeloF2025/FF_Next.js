/**
 * Candidate selection for the untracked-expectation withdrawal.
 *
 * Split from the mutating half so each file stays under the 300-line limit and
 * so the read-only predicate can be reasoned about — and tested — on its own.
 * See ./untrackedExpectationWithdrawal.ts for why the remediation exists.
 */

import { createHash } from 'crypto';

export interface RemediationClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

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
  summaryCount: number;
  digest: string;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * A withdrawable phantom is an unresolved exception whose staff member is not
 * attendance_tracked and for which no evidence of any kind exists.
 *
 * `kind` is not constrained: missing_clock_in is what the pre-479 universe
 * produced, but any purely expectation-raised kind is equally stranded, and it
 * is the evidence guards below — not the label — that make a row safe to
 * withdraw. Everything the blocker column flags would discard real evidence or
 * cross a payroll lock, and is reported rather than silently skipped.
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
           -- IS DISTINCT FROM, not <>. result_status is NULLable and is in fact
           -- NULL for the majority of rows, and NULL <> 'x' yields NULL -- which
           -- is not TRUE, so a plain <> silently falls through this WHEN and
           -- reports the row as withdrawable, while the DELETE's = 'absence_review'
           -- never matches it. That combination cancels the exception and writes
           -- an audit event claiming a deletion that never happened.
           WHEN ds.result_status IS DISTINCT FROM 'absence_review' THEN
             'summary_not_absence_review:' || COALESCE(ds.result_status, 'null')
           WHEN ds.attendance_classification IS NOT NULL THEN 'already_classified'
           WHEN ds.approved_at IS NOT NULL THEN 'already_approved'
           ELSE NULL
         END AS blocker
  FROM attendance_day_exceptions x
  JOIN staff s ON s.id = x.staff_id
  -- LEFT, not INNER: an exception with no summary must surface as a blocker.
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

export async function selectCandidates(
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

/**
 * Fingerprint of WHICH rows are in the plan, not how many.
 *
 * The dry run and the apply are separate process invocations that each re-plan
 * from scratch, so a bare count cannot detect a same-size, different-membership
 * substitution: three candidates resolved by supervisors and three new ones
 * raised between the two runs still totals the same number, and the operator
 * would be applying to a set they never reviewed.
 */
export function candidateDigest(candidates: readonly Candidate[]): string {
  const ids = candidates.map((c) => c.exceptionId).sort();
  return createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 12);
}

/**
 * Distinct (staff, day) pairs among the candidates.
 *
 * Two open exceptions can legitimately share one day (different `kind`s, e.g.
 * missing_clock_in alongside a second expectation-raised flag), and they share
 * ONE summary row. The apply's consistency check compares summary counts against
 * this, not against the exception count, so a shared day is handled correctly
 * rather than aborting the run as if something had drifted.
 */
export function summaryKeys(candidates: readonly Candidate[]): string[] {
  return [...new Set(candidates.map((c) => `${c.staffId}:${c.workDate}`))];
}

export async function planWithdrawal(client: RemediationClient): Promise<WithdrawalPlan> {
  const { candidates, blockers } = await selectCandidates(client, null);
  const staff = new Set(candidates.map((c) => c.staffId));
  const dates = candidates.map((c) => c.workDate).sort();
  return {
    candidates,
    blockers,
    staffCount: staff.size,
    summaryCount: summaryKeys(candidates).length,
    digest: candidateDigest(candidates),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
