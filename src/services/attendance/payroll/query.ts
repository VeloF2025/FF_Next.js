import type { TxnClient } from '@/lib/db-pool';

export interface ActivePayrollLockRow extends Record<string, unknown> {
  week_start_date: string; locked_at: string; locked_by: string;
  lock_reason: string | null; unlocked_at: string | null;
}
export interface PayrollLockHistoryRow extends Record<string, unknown> {
  lock_version: string | number; action: string; actor_user_id: string;
  reason: string; recorded_at: string; result_snapshot: unknown;
}
export interface LockedPayrollDayRow extends Record<string, unknown> {
  staff_id: string; work_date: string;
  result_status: string; locked_period_version: string | number | null;
  result_version: string | number; approved_regular_hrs: string | number | null;
  approved_overtime_hrs: string | number | null; approved_sunday_hrs: string | number | null;
  approved_holiday_hrs: string | number | null; leave_hrs: string | number | null;
  unpaid_hrs: string | number | null; attendance_classification: string | null;
}
export interface PayrollExportRecord extends Record<string, unknown> {
  id: string; week_start_date: string; lock_version: string | number;
  format: string; status: 'generating' | 'ready' | 'failed'; generated_by: string;
  generated_at: string; row_count: string | number; totals: unknown;
  sha256: string | null; storage_path: string | null; error_message: string | null;
}

const EXPORT_COLUMNS = `id, TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date,
  lock_version, format, status, generated_by, generated_at::text, row_count,
  totals, sha256, storage_path, error_message`;

export async function readActorRole(tx: TxnClient, actor: string): Promise<string | null> {
  const row = await tx.queryOne<{ role: string }>(
    '/* payroll:actor-role */ SELECT role FROM users WHERE id = $1::uuid AND is_active = true', [actor]);
  return row?.role ?? null;
}

export async function readActiveLock(tx: TxnClient, week: string): Promise<ActivePayrollLockRow | null> {
  return tx.queryOne<ActivePayrollLockRow>(`/* payroll:active-lock */
    SELECT TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date,
      locked_at::text, locked_by, lock_reason, unlocked_at::text
    FROM attendance_weekly_locks
    WHERE week_start_date = $1::date AND unlocked_at IS NULL FOR UPDATE`, [week]);
}

export async function readLatestHistory(tx: TxnClient, week: string): Promise<PayrollLockHistoryRow | null> {
  return tx.queryOne<PayrollLockHistoryRow>(`/* payroll:lock-history */
    SELECT lock_version, action, actor_user_id, reason, recorded_at::text, result_snapshot
    FROM attendance_weekly_lock_history WHERE week_start_date = $1::date
    ORDER BY lock_version DESC, recorded_at DESC, id DESC LIMIT 1 FOR UPDATE`, [week]);
}

export async function readLockedDays(
  tx: TxnClient, week: string, weekEnd: string,
): Promise<LockedPayrollDayRow[]> {
  return tx.query<LockedPayrollDayRow>(`/* payroll:locked-days */
    SELECT ds.staff_id, TO_CHAR(ds.work_date, 'YYYY-MM-DD') AS work_date, ds.result_status,
      ds.locked_period_version, ds.result_version, ds.approved_regular_hrs,
      ds.approved_overtime_hrs, ds.approved_sunday_hrs, ds.approved_holiday_hrs,
      ds.leave_hrs, ds.unpaid_hrs, ds.attendance_classification
    FROM attendance_daily_summaries ds
    WHERE ds.work_date BETWEEN $1::date AND $2::date AND ds.result_status = 'locked'
    ORDER BY ds.staff_id, ds.work_date FOR SHARE OF ds`, [week, weekEnd]);
}

export async function readExistingExport(
  tx: TxnClient, week: string, version: number, format: string,
): Promise<PayrollExportRecord | null> {
  return tx.queryOne<PayrollExportRecord>(`/* payroll:existing-export */ SELECT ${EXPORT_COLUMNS}
    FROM attendance_payroll_exports
    WHERE week_start_date = $1::date AND lock_version = $2::bigint AND format = $3 FOR UPDATE`,
  [week, version, format]);
}

export async function claimExport(
  tx: TxnClient, week: string, version: number, format: string, actor: string,
): Promise<PayrollExportRecord | null> {
  return tx.queryOne<PayrollExportRecord>(`/* payroll:claim-export */
    INSERT INTO attendance_payroll_exports
      (week_start_date, lock_version, format, status, generated_by)
    VALUES ($1::date, $2::bigint, $3, 'generating', $4::uuid)
    ON CONFLICT (week_start_date, lock_version, format) DO UPDATE SET
      status = 'generating', generated_by = EXCLUDED.generated_by,
      generated_at = NOW(), row_count = 0, totals = '{}'::jsonb,
      sha256 = NULL, storage_path = NULL, error_message = NULL
    RETURNING ${EXPORT_COLUMNS}`, [week, version, format, actor]);
}

export async function markReady(tx: TxnClient, id: string, rowCount: number,
  totals: Record<string, string>, sha256: string, path: string): Promise<PayrollExportRecord | null> {
  return tx.queryOne<PayrollExportRecord>(`/* payroll:mark-ready */ UPDATE attendance_payroll_exports
    SET status = 'ready', row_count = $2, totals = $3::jsonb, sha256 = $4,
      storage_path = $5, error_message = NULL WHERE id = $1::uuid AND status = 'generating'
    RETURNING ${EXPORT_COLUMNS}`, [id, rowCount, totals, sha256, path]);
}

export async function markFailed(tx: TxnClient, id: string, message: string): Promise<PayrollExportRecord | null> {
  return tx.queryOne<PayrollExportRecord>(`/* payroll:mark-failed */ UPDATE attendance_payroll_exports
    SET status = 'failed', error_message = $2, sha256 = NULL, storage_path = NULL
    WHERE id = $1::uuid AND status = 'generating' RETURNING ${EXPORT_COLUMNS}`, [id, message]);
}

export async function writeReadyEvent(tx: TxnClient, id: string, actor: string,
  version: number, sha256: string): Promise<void> {
  const row = await tx.queryOne<{ id: string }>(`/* payroll:ready-event */
    INSERT INTO attendance_decision_events
      (entity_type, entity_key, action, actor_user_id, reason, before_value, after_value)
    VALUES ('payroll_export', $1, 'generated', $2::uuid, 'Locked payroll hours exported',
      '{}'::jsonb, $3::jsonb) RETURNING id`, [id, actor, { lockVersion: version, sha256 }]);
  if (!row) throw new Error('Payroll export audit event write returned no row');
}

export async function readExport(tx: TxnClient, id: string): Promise<PayrollExportRecord | null> {
  return tx.queryOne<PayrollExportRecord>(`/* payroll:readback */ SELECT ${EXPORT_COLUMNS}
    FROM attendance_payroll_exports WHERE id = $1::uuid`, [id]);
}
