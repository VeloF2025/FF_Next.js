/**
 * Reverse half of the untracked-expectation withdrawal.
 *
 * Restores the deleted phantom summaries and reopens the exceptions that this
 * remediation — and only this remediation — cancelled.
 *
 * SCOPED TO ONE RUN. `WITHDRAWAL_ACTION` and `EXCEPTION_REASON` are module
 * constants shared by every apply the tool has ever made, so matching on those
 * alone would undo the tool's entire history: a rollback intended to reverse
 * March's batch would also reopen January's, dropping months-settled exceptions
 * back into supervisor queues. Each apply therefore stamps a `runId` into both
 * of its audit events, and a rollback targets exactly one — defaulting to the
 * most recent.
 *
 * The decision events themselves are never deleted. The table forbids it, and
 * the history of "this was withdrawn, then restored" is worth more than a tidy
 * ledger.
 */

import {
  EXCEPTION_REASON, WITHDRAWAL_ACTION, type RemediationClient,
} from './untrackedExpectationWithdrawal';

export interface RollbackResult {
  runId: string | null;
  summariesRestored: number;
  exceptionsReopened: number;
}

/**
 * Most recent apply.
 *
 * Events written before run stamping existed — the one-off SQL that cleared the
 * original 53 phantoms — carry no runId, and attendance_decision_events is
 * append-only so they cannot be backfilled. They are addressed collectively as
 * LEGACY_RUN_ID so that batch stays reversible rather than being stranded by the
 * introduction of scoping.
 */
export const LEGACY_RUN_ID = 'legacy';

export async function latestRunId(client: RemediationClient): Promise<string | null> {
  const { rows } = await client.query<{ run_id: string }>(`
    SELECT COALESCE(after_value->>'runId', $2::text) AS run_id
    FROM attendance_decision_events
    WHERE action = $1::text
    ORDER BY recorded_at DESC LIMIT 1`, [WITHDRAWAL_ACTION, LEGACY_RUN_ID]);
  return rows[0]?.run_id ?? null;
}

/**
 * `jsonb_populate_record` silently yields NULL for any column missing from the
 * stored payload, so a column added or renamed since the withdrawal would be
 * restored as NULL with no error — quiet data loss on the one path whose entire
 * job is faithful recovery. Compare the shapes first and refuse instead.
 *
 * Columns the payload has but the table no longer does are harmless (ignored),
 * so they do not block: the data for them is gone either way, and refusing
 * would only prevent recovery of everything else.
 */
async function assertRestorable(client: RemediationClient, runId: string): Promise<void> {
  const { rows } = await client.query<{ missing: string[] }>(`
    WITH payload AS (
      SELECT DISTINCT jsonb_object_keys(before_value) AS key
      FROM attendance_decision_events
      WHERE entity_type = 'daily_result' AND action = $1::text
        AND COALESCE(after_value->>'runId', '${LEGACY_RUN_ID}') = $2::text
    ), live AS (
      SELECT column_name::text AS key FROM information_schema.columns
      WHERE table_name = 'attendance_daily_summaries'
        AND table_schema = ANY(current_schemas(false))
    )
    -- An empty payload means this run withdrew no summaries (or does not
    -- exist). Without this guard, live EXCEPT payload returns EVERY column and
    -- the check fires spuriously, reporting schema drift and blocking a
    -- rollback that simply has nothing to restore.
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM payload) THEN '{}'::text[]
           ELSE COALESCE(
             ARRAY(SELECT key FROM live EXCEPT SELECT key FROM payload ORDER BY 1), '{}')
           END AS missing`, [WITHDRAWAL_ACTION, runId]);
  const missing = rows[0]?.missing ?? [];
  if (missing.length > 0) {
    throw new Error(
      `attendance_daily_summaries has gained column(s) since run ${runId}: ${missing.join(', ')}. ` +
      'Restoring would write NULL into them. Reconcile the schema, or restore manually from ' +
      "the events' before_value.",
    );
  }
}

export async function rollbackWithdrawal(
  client: RemediationClient,
  targetRunId?: string,
): Promise<RollbackResult> {
  const runId = targetRunId ?? await latestRunId(client);
  if (!runId) return { runId: null, summariesRestored: 0, exceptionsReopened: 0 };
  await assertRestorable(client, runId);

  // DISTINCT ON guards the case where one (staff, day) carries two events:
  // ON CONFLICT DO NOTHING cannot affect the same row twice in one statement and
  // would abort the whole rollback rather than skip the duplicate.
  //
  // RETURNING the keys actually inserted is what correlates the two halves. A
  // day whose summary was NOT restored — because the staff member was opted back
  // in and the reconciler has since written a fresh, legitimate summary, so the
  // INSERT hit ON CONFLICT DO NOTHING — must not have its exception reopened.
  // That would drop an awaiting_supervisor exception next to a real result.
  const restored = await client.query<{ staff_id: string; work_date: string }>(`
    INSERT INTO attendance_daily_summaries
    SELECT (jsonb_populate_record(NULL::attendance_daily_summaries, e.before_value)).*
    FROM (
      SELECT DISTINCT ON (entity_key) before_value
      FROM attendance_decision_events
      WHERE entity_type = 'daily_result' AND action = $1::text
        AND COALESCE(after_value->>'runId', '${LEGACY_RUN_ID}') = $2::text
      ORDER BY entity_key, recorded_at DESC
    ) e
    ON CONFLICT (staff_id, work_date) DO NOTHING
    RETURNING staff_id::text, work_date::text`, [WITHDRAWAL_ACTION, runId]);

  // Matched on this remediation's own reason string so a genuine supervisor
  // cancellation is never reopened, scoped to this run, and further narrowed to
  // the days whose summary this rollback just put back.
  const reopened = await client.query(`
    UPDATE attendance_day_exceptions x
    SET status = COALESCE(e.before_value->>'status', 'awaiting_supervisor'),
        resolved_at = NULL, resolved_by = NULL, resolution_reason = NULL,
        updated_at = NOW()
    FROM attendance_decision_events e
    WHERE e.entity_type = 'day_exception' AND e.action = $1::text
      AND COALESCE(e.after_value->>'runId', '${LEGACY_RUN_ID}') = $2::text
      AND x.id::text = e.entity_key
      AND x.status = 'cancelled'
      AND x.resolution_reason = $3::text
      AND EXISTS (
        SELECT 1 FROM UNNEST($4::uuid[], $5::date[]) AS r(staff_id, work_date)
        WHERE r.staff_id = x.staff_id AND r.work_date = x.work_date
      )`, [
    WITHDRAWAL_ACTION, runId, EXCEPTION_REASON,
    restored.rows.map((r) => r.staff_id), restored.rows.map((r) => r.work_date),
  ]);

  return {
    runId,
    summariesRestored: restored.rows.length,
    exceptionsReopened: reopened.rowCount ?? 0,
  };
}
