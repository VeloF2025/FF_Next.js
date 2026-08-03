/**
 * Reverse half of the legacy auto-close remediation, plus the policy backdate
 * that is deliberately kept separate from it.
 *
 * Every statement is guarded on the backup tables actually existing, and every
 * restore is conditional on the row still holding what the remediation wrote.
 * A restore that blindly overwrote current values would destroy any supervisor
 * correction or worker note made since — the audit trail the attendance
 * workflow exists to keep.
 */

import { RESET_NOTE, type RemediationClient } from './legacyAutocloseReset';

export interface RollbackResult {
  applied: boolean;
  summariesRestored: number;
  entriesRestored: number;
  notesStripped: number;
  skippedChangedSummaries: number;
}

/**
 * Resolved through search_path rather than pinned to public, so the guard is
 * correct under any schema the caller has selected.
 */
async function backupExists(client: RemediationClient, table: string): Promise<boolean> {
  const { rows } = await client.query<{ present: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS present`, [table]);
  return rows[0]?.present === true;
}

async function affected(
  client: RemediationClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const result = await client.query(text, values);
  return result.rowCount ?? 0;
}

export async function rollbackRemediation(client: RemediationClient): Promise<RollbackResult> {
  const empty: RollbackResult = {
    applied: false, summariesRestored: 0, entriesRestored: 0,
    notesStripped: 0, skippedChangedSummaries: 0,
  };
  // Refuse silently-successful no-ops: a rollback that reports success while
  // restoring nothing is worse than one that errors.
  if (!(await backupExists(client, 'attendance_legacy_autoclose_backup')) ||
      !(await backupExists(client, 'attendance_legacy_autoclose_summary_backup'))) {
    return empty;
  }

  // Anything no longer holding the zeroes we wrote has been legitimately
  // recomputed since; leave it alone and report the count.
  const changed = await client.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM attendance_daily_summaries ds
    JOIN attendance_legacy_autoclose_summary_backup b
      ON ds.staff_id = b.staff_id AND ds.work_date = b.work_date
    WHERE ds.regular_hrs <> 0 OR ds.overtime_hrs <> 0 OR ds.sunday_hrs <> 0
       OR ds.holiday_hrs <> 0 OR ds.night_hrs <> 0`);
  const skippedChangedSummaries = Number(changed.rows[0]?.n ?? 0);

  const summariesRestored = await affected(client, `
    UPDATE attendance_daily_summaries ds
    SET regular_hrs = b.regular_hrs, overtime_hrs = b.overtime_hrs,
        sunday_hrs = b.sunday_hrs, holiday_hrs = b.holiday_hrs,
        night_hrs = b.night_hrs, computed_at = NOW()
    FROM attendance_legacy_autoclose_summary_backup b
    WHERE ds.staff_id = b.staff_id AND ds.work_date = b.work_date
      AND ds.regular_hrs = 0 AND ds.overtime_hrs = 0 AND ds.sunday_hrs = 0
      AND ds.holiday_hrs = 0 AND ds.night_hrs = 0`);

  const entriesRestored = await affected(client, `
    UPDATE attendance_entries e
    SET clock_out_at = b.clock_out_at, received_at_out = b.received_at_out,
        updated_at = NOW()
    FROM attendance_legacy_autoclose_backup b
    WHERE b.entry_id = e.id AND e.clock_out_at IS NULL`, []);

  // Strip only the line this remediation appended. Restoring notes wholesale
  // from the backup would delete anything written since.
  const notesStripped = await affected(client, `
    UPDATE attendance_entries e
    SET notes = NULLIF(
          CASE WHEN e.notes = $1::text THEN ''
               ELSE REPLACE(e.notes, E'\n' || $1::text, '') END, '')
    FROM attendance_legacy_autoclose_backup b
    WHERE b.entry_id = e.id AND e.notes LIKE '%' || $1::text || '%'`, [RESET_NOTE]);

  return {
    applied: true,
    summariesRestored,
    entriesRestored,
    notesStripped,
    skippedChangedSummaries,
  };
}

export interface PolicyBackdateResult {
  policyId: string;
  previousActiveFrom: string;
  newActiveFrom: string;
}

/**
 * Kept separate from applyRemediation on purpose. Backdating active_from is
 * what makes the reconciler's coverage predicates start returning these days,
 * and the nightly cron reconciles a trailing 14-day window — so this is the
 * step that puts work into the review queue, whether or not anyone runs an
 * explicit replay. Clearing the fabricated evidence is safe at any time once
 * the #2362 guard is deployed; this is not.
 */
export async function backdatePolicy(
  client: RemediationClient,
  activeFrom: string,
): Promise<PolicyBackdateResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activeFrom)) {
    throw new Error(`activeFrom must be YYYY-MM-DD; got ${activeFrom}`);
  }
  const { rows } = await client.query<{ id: string; active_from: string }>(`
    SELECT id::text, TO_CHAR(active_from, 'YYYY-MM-DD') AS active_from
    FROM attendance_schedule_policies
    WHERE active_to IS NULL
    ORDER BY active_from DESC`);
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one open schedule policy; found ${rows.length}`);
  }
  const policy = rows[0]!;
  await client.query(`
    CREATE TABLE IF NOT EXISTS attendance_legacy_autoclose_policy_backup (
      policy_id UUID PRIMARY KEY,
      active_from DATE NOT NULL,
      backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await client.query(`
    INSERT INTO attendance_legacy_autoclose_policy_backup (policy_id, active_from)
    VALUES ($1::uuid, $2::date)
    ON CONFLICT (policy_id) DO NOTHING`, [policy.id, policy.active_from]);

  // Target the captured id, not a literal date, and assert the write landed —
  // a policy update that silently matches zero rows would leave the whole
  // remediation premise unmet while reporting success.
  const updated = await client.query(`
    UPDATE attendance_schedule_policies SET active_from = $2::date
    WHERE id = $1::uuid`, [policy.id, activeFrom]);
  if ((updated.rowCount ?? 0) !== 1) {
    throw new Error(`Policy backdate affected ${updated.rowCount ?? 0} rows; expected 1`);
  }
  return {
    policyId: policy.id,
    previousActiveFrom: policy.active_from,
    newActiveFrom: activeFrom,
  };
}

export async function restorePolicy(client: RemediationClient): Promise<PolicyBackdateResult | null> {
  if (!(await backupExists(client, 'attendance_legacy_autoclose_policy_backup'))) return null;
  const { rows } = await client.query<{ policy_id: string; active_from: string }>(`
    SELECT policy_id::text, TO_CHAR(active_from, 'YYYY-MM-DD') AS active_from
    FROM attendance_legacy_autoclose_policy_backup`);
  const backup = rows[0];
  if (!backup) return null;
  const current = await client.query<{ active_from: string }>(`
    SELECT TO_CHAR(active_from, 'YYYY-MM-DD') AS active_from
    FROM attendance_schedule_policies WHERE id = $1::uuid`, [backup.policy_id]);
  const previous = current.rows[0]?.active_from ?? null;
  const updated = await client.query(`
    UPDATE attendance_schedule_policies SET active_from = $2::date
    WHERE id = $1::uuid`, [backup.policy_id, backup.active_from]);
  if ((updated.rowCount ?? 0) !== 1) {
    throw new Error(`Policy restore affected ${updated.rowCount ?? 0} rows; expected 1`);
  }
  return {
    policyId: backup.policy_id,
    previousActiveFrom: previous ?? 'unknown',
    newActiveFrom: backup.active_from,
  };
}
