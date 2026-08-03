/**
 * Remediation for the fabricated clock-outs written by the pre-#2351 reconciler.
 *
 * Until PR #2351 the reconcile cron closed a dangling entry by stamping
 * clock_in_at + a 9h cap into clock_out_at, then inserted the matching
 * missing_clock_out exception in a SEPARATE, un-transacted statement. That
 * INSERT built its details with jsonb_build_object(..., ${row.clock_in_at})
 * through the Neon shim with no cast, so PostgreSQL could not infer the
 * parameter type and every call failed with 42P08 — after the UPDATE had
 * already committed. The close succeeded; the flag never did, not once.
 *
 * This is deliberately NOT a migration. scripts/deploy-local-main.sh applies
 * pending migrations on every deploy against the single shared dev+prod
 * database, so a routine daytime dev deploy would mutate production attendance
 * — possibly before the #2362 guard that makes a replay safe is even live.
 * An operator runs this, in dry-run first, when they mean to.
 */

export interface RemediationClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export const RESET_NOTE =
  '[legacy auto-close remediation: synthetic clock-out cleared; original preserved in attendance_legacy_autoclose_backup]';

export interface Candidate {
  entryId: string;
  staffId: string;
  workDate: string;
  clockOutAt: string;
  /** regular + overtime. The other three columns overlap these; see the SQL. */
  fabricatedHrs: number;
}

export interface Blocker {
  reason: string;
  entryId: string;
  staffId: string;
  workDate: string;
}

export interface RemediationPlan {
  candidates: Candidate[];
  blockers: Blocker[];
  /** Eligible entries with no summary row at all — nothing to zero for them. */
  withoutSummary: number;
  staffCount: number;
  firstDate: string | null;
  lastDate: string | null;
  fabricatedHours: number;
}

/**
 * A fabricated closure is an auto-closed entry whose clock-out sits exactly 9h
 * after clock-in — the old cap — with no missing_clock_out exception in either
 * the pre-475 table or the current one.
 *
 * Everything a blocker flags is a row where mutating would either cross a
 * payroll lock or destroy a value the app itself would refuse to overwrite.
 * They are reported, never silently skipped.
 */
const CANDIDATE_SQL = `
  SELECT e.id AS entry_id, e.staff_id::text AS staff_id,
         TO_CHAR(e.work_date, 'YYYY-MM-DD') AS work_date,
         e.clock_out_at::text AS clock_out_at,
         (ds.staff_id IS NULL) AS without_summary,
         -- regular + overtime ONLY. Migration 319 is explicit that sunday_hrs,
         -- holiday_hrs and night_hrs OVERLAP these two — they are premium
         -- overlays a payroll vendor picks multipliers from, not additional
         -- hours. Summing all five double-counts; summing regular alone
         -- under-counts the overtime that is also fabricated.
         COALESCE(ds.regular_hrs + ds.overtime_hrs, 0)::float AS fabricated_hrs,
         CASE
           WHEN ds.result_status = 'locked' THEN 'daily_result_locked'
           WHEN ds.wage_amount_cents IS NOT NULL THEN 'wage_already_computed'
           WHEN ds.calculation_fingerprint IS NOT NULL THEN 'already_projected'
           WHEN EXISTS (
             SELECT 1 FROM attendance_weekly_locks wl
             WHERE wl.week_start_date = DATE_TRUNC('week', e.work_date)::date
               AND wl.unlocked_at IS NULL
           ) THEN 'payroll_week_locked'
           WHEN EXISTS (
             SELECT 1 FROM attendance_entries sibling
             WHERE sibling.staff_id = e.staff_id
               AND sibling.work_date = e.work_date
               AND sibling.id <> e.id
           ) THEN 'shares_day_with_another_entry'
           ELSE NULL
         END AS blocker
  FROM attendance_entries e
  -- LEFT, not INNER: the legacy auto-close path had no date bound while
  -- summaries were only written over a trailing window, so an entry can carry
  -- a fabricated clock-out with no summary row at all. An inner join would
  -- drop those from BOTH candidates and blockers — silently invisible to the
  -- operator and to --expect.
  LEFT JOIN attendance_daily_summaries ds
    ON ds.staff_id = e.staff_id AND ds.work_date = e.work_date
  WHERE e.status = 'auto_closed'
    AND e.clock_out_at IS NOT NULL
    AND e.clock_out_at - e.clock_in_at = INTERVAL '9 hours'
    AND NOT EXISTS (
      SELECT 1 FROM attendance_exceptions x
      WHERE x.entry_id = e.id AND x.exception_kind = 'missing_clock_out'
    )
    -- Keyed on the day, not the entry: attendance_day_exceptions.entry_id is
    -- nullable (ON DELETE SET NULL, and insertExceptionWithoutEntry writes
    -- NULL), so an entry-keyed guard would miss a day that is already flagged.
    AND NOT EXISTS (
      SELECT 1 FROM attendance_day_exceptions dx
      WHERE dx.staff_id = e.staff_id AND dx.work_date = e.work_date
        AND dx.kind = 'missing_clock_out'
    )
    AND ($1::uuid[] IS NULL OR e.id = ANY($1::uuid[]))
  ORDER BY e.work_date, e.staff_id`;

interface CandidateRow extends Record<string, unknown> {
  entry_id: string; staff_id: string; work_date: string; clock_out_at: string;
  fabricated_hrs: number; without_summary: boolean; blocker: string | null;
}

async function selectCandidates(
  client: RemediationClient,
  ids: readonly string[] | null,
): Promise<{ candidates: Candidate[]; blockers: Blocker[]; withoutSummary: number }> {
  const { rows } = await client.query<CandidateRow>(CANDIDATE_SQL, [ids]);
  const candidates: Candidate[] = [];
  const blockers: Blocker[] = [];
  let withoutSummary = 0;
  for (const row of rows) {
    const base = { entryId: row.entry_id, staffId: row.staff_id, workDate: row.work_date };
    if (row.blocker) { blockers.push({ ...base, reason: row.blocker }); continue; }
    if (row.without_summary) withoutSummary += 1;
    candidates.push({
      ...base, clockOutAt: row.clock_out_at, fabricatedHrs: Number(row.fabricated_hrs),
    });
  }
  return { candidates, blockers, withoutSummary };
}

export async function planRemediation(client: RemediationClient): Promise<RemediationPlan> {
  const { candidates, blockers, withoutSummary } = await selectCandidates(client, null);
  const staff = new Set(candidates.map((c) => c.staffId));
  const dates = candidates.map((c) => c.workDate).sort();
  return {
    candidates,
    blockers,
    withoutSummary,
    staffCount: staff.size,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    fabricatedHours: candidates.reduce((sum, c) => sum + c.fabricatedHrs, 0),
  };
}

export const BACKUP_DDL = `
  CREATE TABLE IF NOT EXISTS attendance_legacy_autoclose_backup (
    entry_id UUID PRIMARY KEY,
    staff_id UUID NOT NULL,
    work_date DATE NOT NULL,
    clock_out_at TIMESTAMPTZ,
    received_at_out TIMESTAMPTZ,
    notes TEXT,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  -- Keyed by the summary's own primary key, so there is exactly one backup row
  -- per summary however many entries map to that day. Sharing a per-entry key
  -- here would let a second eligible entry on the same day insert a second row
  -- holding already-zeroed values, and the restore would pick between them
  -- arbitrarily.
  CREATE TABLE IF NOT EXISTS attendance_legacy_autoclose_summary_backup (
    staff_id UUID NOT NULL,
    work_date DATE NOT NULL,
    regular_hrs NUMERIC,
    overtime_hrs NUMERIC,
    sunday_hrs NUMERIC,
    holiday_hrs NUMERIC,
    night_hrs NUMERIC,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (staff_id, work_date)
  );
  CREATE TABLE IF NOT EXISTS attendance_legacy_autoclose_policy_backup (
    policy_id UUID PRIMARY KEY,
    active_from DATE NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`;

export interface ApplyResult {
  entriesBackedUp: number;
  summariesBackedUp: number;
  summariesZeroed: number;
  entriesCleared: number;
}

/**
 * Caller supplies the transaction. Every statement is driven by the explicit
 * candidate id list rather than by re-running the predicate, so what a dry-run
 * showed is exactly what gets mutated.
 */
export async function applyRemediation(
  client: RemediationClient,
  candidates: readonly Candidate[],
): Promise<ApplyResult> {
  if (candidates.length === 0) {
    return { entriesBackedUp: 0, summariesBackedUp: 0, summariesZeroed: 0, entriesCleared: 0 };
  }
  await client.query(BACKUP_DDL);
  const ids = candidates.map((c) => c.entryId);

  // The plan was built in an earlier, separate transaction. A weekly lock, a
  // wage, or a nightly reprojection can land in between, so eligibility is
  // re-asserted here, inside the caller's transaction, against the same
  // predicate. Anything that moved aborts the whole apply rather than being
  // quietly mutated.
  const recheck = await selectCandidates(client, ids);
  if (recheck.candidates.length !== ids.length || recheck.blockers.length > 0) {
    const reasons = [...new Set(recheck.blockers.map((b) => b.reason))].sort().join(', ');
    throw new Error(
      `Eligibility changed since the dry run: ${recheck.candidates.length}/${ids.length} still eligible` +
      (reasons ? ` (now blocked by: ${reasons})` : '') + '. Re-run the dry run.',
    );
  }

  const entriesBackedUp = await affected(client, `
    INSERT INTO attendance_legacy_autoclose_backup (
      entry_id, staff_id, work_date, clock_out_at, received_at_out, notes
    )
    SELECT e.id, e.staff_id, e.work_date, e.clock_out_at, e.received_at_out, e.notes
    FROM attendance_entries e
    WHERE e.id = ANY($1::uuid[]) AND e.clock_out_at IS NOT NULL
    ON CONFLICT (entry_id) DO NOTHING`, [ids]);

  const summariesBackedUp = await affected(client, `
    INSERT INTO attendance_legacy_autoclose_summary_backup (
      staff_id, work_date, regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, night_hrs
    )
    SELECT ds.staff_id, ds.work_date, ds.regular_hrs, ds.overtime_hrs,
           ds.sunday_hrs, ds.holiday_hrs, ds.night_hrs
    FROM attendance_daily_summaries ds
    JOIN attendance_entries e ON e.staff_id = ds.staff_id AND e.work_date = ds.work_date
    WHERE e.id = ANY($1::uuid[])
    ON CONFLICT (staff_id, work_date) DO NOTHING`, [ids]);

  // Zero only while the row still holds exactly what was backed up. A re-run
  // after a legitimate reprojection or an approved correction therefore does
  // nothing, instead of destroying the corrected hours and leaving the backup
  // holding only the fabricated originals. Also scoped to THIS run's entries. Joining the whole backup table would let a
  // later apply re-zero every summary any earlier run ever backed up —
  // including days that a rollback has since restored and that are now
  // payroll-locked and reported as blockers in the very same run.
  const summariesZeroed = await affected(client, `
    UPDATE attendance_daily_summaries ds
    SET regular_hrs = 0, overtime_hrs = 0, sunday_hrs = 0,
        holiday_hrs = 0, night_hrs = 0, computed_at = NOW()
    FROM attendance_legacy_autoclose_summary_backup b
    JOIN attendance_entries e
      ON e.staff_id = b.staff_id AND e.work_date = b.work_date
    WHERE ds.staff_id = b.staff_id AND ds.work_date = b.work_date
      AND e.id = ANY($1::uuid[])
      AND ds.regular_hrs IS NOT DISTINCT FROM b.regular_hrs
      AND ds.overtime_hrs IS NOT DISTINCT FROM b.overtime_hrs
      AND ds.sunday_hrs IS NOT DISTINCT FROM b.sunday_hrs
      AND ds.holiday_hrs IS NOT DISTINCT FROM b.holiday_hrs
      AND ds.night_hrs IS NOT DISTINCT FROM b.night_hrs
      AND (ds.regular_hrs <> 0 OR ds.overtime_hrs <> 0 OR ds.sunday_hrs <> 0
           OR ds.holiday_hrs <> 0 OR ds.night_hrs <> 0)`, [ids]);

  const entriesCleared = await affected(client, `
    UPDATE attendance_entries e
    SET clock_out_at = NULL, received_at_out = NULL, updated_at = NOW(),
        notes = CONCAT_WS(E'\n', NULLIF(e.notes, ''), $2::text)
    FROM attendance_legacy_autoclose_backup b
    WHERE b.entry_id = e.id AND e.id = ANY($1::uuid[])
      AND e.clock_out_at IS NOT NULL`, [ids, RESET_NOTE]);

  return { entriesBackedUp, summariesBackedUp, summariesZeroed, entriesCleared };
}

async function affected(
  client: RemediationClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const result = await client.query(text, values);
  return result.rowCount ?? 0;
}
