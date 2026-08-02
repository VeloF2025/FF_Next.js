import type { ActivePayrollLockRow, LockedPayrollDayRow, PayrollLockHistoryRow } from './query';
import {
  AttendancePayrollExportError, PAYROLL_LOCK_SNAPSHOT_VERSION,
  type PayrollLockSnapshotRow,
} from './types';

export function validateActivePayrollLock(
  active: ActivePayrollLockRow,
  history: PayrollLockHistoryRow | null,
  expected?: number,
): number {
  const version = Number(history?.lock_version);
  if (!history || !Number.isInteger(version) || version < 1 ||
      !['lock', 'relock'].includes(history.action) || history.actor_user_id !== active.locked_by ||
      history.reason !== active.lock_reason || Number.isNaN(new Date(history.recorded_at).getTime()) ||
      Number.isNaN(new Date(active.locked_at).getTime()) || history.recorded_at !== active.locked_at) {
    fail('export_version_conflict', 'Active attendance lock and immutable history are inconsistent');
  }
  if (expected !== undefined && expected !== version) {
    fail('export_version_conflict', `Active attendance lock version is ${version}, not ${expected}`);
  }
  return version;
}

export function readPayrollSnapshot(value: unknown, lockVersion: number): PayrollLockSnapshotRow[] {
  const root = jsonObject(value);
  const snapshot = jsonObject(root?.payrollSnapshot);
  if (!snapshot || snapshot.version !== PAYROLL_LOCK_SNAPSHOT_VERSION || !Array.isArray(snapshot.rows) ||
      snapshot.rows.length === 0) {
    fail('export_version_conflict', 'Active lock history has no supported payroll snapshot');
  }
  return snapshot.rows.map((value) => snapshotRow(value, lockVersion));
}

export function validateLockedRows(
  snapshotRows: PayrollLockSnapshotRow[], liveRows: LockedPayrollDayRow[], lockVersion: number,
): void {
  if (liveRows.length === 0) fail('empty_period', 'The active lock contains no locked attendance results');
  const snapshots = new Map<string, PayrollLockSnapshotRow>();
  for (const row of snapshotRows) {
    const key = dayKey(row.staff_id, row.work_date);
    if (snapshots.has(key)) fail('export_version_conflict', 'Payroll snapshot contains a duplicate day');
    snapshots.set(key, row);
  }
  if (snapshots.size !== liveRows.length) drift();
  for (const live of liveRows) {
    const frozen = snapshots.get(dayKey(live.staff_id, live.work_date));
    if (!frozen || live.result_status !== 'locked' || integer(live.locked_period_version) !== lockVersion ||
        integer(live.result_version) !== frozen.result_version ||
        hours(live.approved_regular_hrs) !== frozen.approved_regular_hrs ||
        hours(live.approved_overtime_hrs) !== frozen.approved_overtime_hrs ||
        hours(live.approved_sunday_hrs) !== frozen.approved_sunday_hrs ||
        hours(live.approved_holiday_hrs) !== frozen.approved_holiday_hrs ||
        hours(live.leave_hrs) !== frozen.leave_hrs || hours(live.unpaid_hrs) !== frozen.unpaid_hrs ||
        live.attendance_classification !== frozen.attendance_classification) drift();
  }
}

function snapshotRow(value: unknown, lockVersion: number): PayrollLockSnapshotRow {
  const row = jsonObject(value);
  if (!row || !text(row.staff_id) || !text(row.employee_id) || !text(row.full_name) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(row.work_date ?? '')) ||
      integer(row.result_version) === null || integer(row.locked_period_version) !== lockVersion ||
      (row.project_id !== null && typeof row.project_id !== 'string') ||
      (row.site_id !== null && typeof row.site_id !== 'string') ||
      (row.attendance_classification !== null && typeof row.attendance_classification !== 'string')) {
    fail('export_version_conflict', 'Payroll snapshot row is incomplete or has the wrong version');
  }
  return {
    staff_id: String(row.staff_id), employee_id: String(row.employee_id), full_name: String(row.full_name),
    work_date: String(row.work_date), approved_regular_hrs: hours(row.approved_regular_hrs),
    approved_overtime_hrs: hours(row.approved_overtime_hrs),
    approved_sunday_hrs: hours(row.approved_sunday_hrs),
    approved_holiday_hrs: hours(row.approved_holiday_hrs), leave_hrs: hours(row.leave_hrs),
    unpaid_hrs: hours(row.unpaid_hrs), attendance_classification: row.attendance_classification as string | null,
    project_id: row.project_id as string | null, site_id: row.site_id as string | null,
    result_version: integer(row.result_version)!, locked_period_version: lockVersion,
  };
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function text(value: unknown): boolean { return typeof value === 'string' && value.trim().length > 0; }
function integer(value: unknown): number | null {
  const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function hours(value: unknown): string {
  if (value === null || value === undefined || value === '') drift();
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) drift();
  return parsed.toFixed(2);
}
function dayKey(staff: string, date: string): string { return `${staff}:${date}`; }
function drift(): never { fail('export_version_conflict', 'Locked attendance rows differ from payroll snapshot'); }
function fail(code: ConstructorParameters<typeof AttendancePayrollExportError>[0], message: string): never {
  throw new AttendancePayrollExportError(code, message);
}
