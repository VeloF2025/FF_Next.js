import type { TxnClient } from '@/lib/db-pool';

export const PAYROLL_EXPORT_COLUMNS = [
  'staff_id', 'employee_id', 'full_name', 'work_date',
  'ordinary_hours', 'overtime_hours', 'sunday_hours',
  'public_holiday_hours', 'approved_leave_hours', 'sick_leave_hours',
  'unpaid_hours', 'project_id', 'site_id', 'lock_version', 'audit_reference',
] as const;

export type PayrollExportFormat = 'csv' | 'xlsx';
export type PayrollExportColumn = typeof PAYROLL_EXPORT_COLUMNS[number];
export type PayrollExportRow = Record<PayrollExportColumn, string>;
export type PayrollExportTotals = Record<
  'ordinary_hours' | 'overtime_hours' | 'sunday_hours' |
  'public_holiday_hours' | 'approved_leave_hours' | 'sick_leave_hours' | 'unpaid_hours',
  string
>;

export const PAYROLL_LOCK_SNAPSHOT_VERSION = 1 as const;
export interface PayrollLockSnapshotRow {
  staff_id: string; employee_id: string; full_name: string; work_date: string;
  approved_regular_hrs: string; approved_overtime_hrs: string;
  approved_sunday_hrs: string; approved_holiday_hrs: string;
  leave_hrs: string; unpaid_hrs: string; attendance_classification: string | null;
  project_id: string | null; site_id: string | null;
  result_version: number; locked_period_version: number;
}
export interface PayrollLockSnapshot {
  version: typeof PAYROLL_LOCK_SNAPSHOT_VERSION;
  rows: PayrollLockSnapshotRow[];
}

export interface PreparePayrollExportArgs {
  weekStartDate: string;
  format: PayrollExportFormat;
  actorUserId: string;
  expectedLockVersion?: number;
  dryRun?: boolean;
}

export interface PayrollExportPreview {
  dryRun: true;
  format: PayrollExportFormat;
  lockVersion: number;
  rowCount: number;
  rows: PayrollExportRow[];
  totals: PayrollExportTotals;
}

export interface PreparedPayrollExport {
  dryRun: false;
  exportId: string;
  format: PayrollExportFormat;
  lockVersion: number;
  rowCount: number;
  rows: PayrollExportRow[];
  totals: PayrollExportTotals;
  sha256: string;
  bytes: Buffer;
  filename: string;
  storagePath: string;
}

export interface PayrollExportStorage {
  upload(bytes: Buffer, filename: string): Promise<{ path: string; filename: string }>;
  remove(filename: string): Promise<boolean>;
}

export type PayrollTransactionRunner = <T>(work: (tx: TxnClient) => Promise<T>) => Promise<T>;

export type AttendancePayrollExportErrorCode =
  | 'invalid_week' | 'invalid_format' | 'forbidden' | 'period_locked'
  | 'export_version_conflict' | 'empty_period' | 'invalid_locked_results'
  | 'invalid_staff_identity' | 'storage_failed' | 'persistence_failed' | 'cleanup_failed';

export class AttendancePayrollExportError extends Error {
  constructor(public readonly code: AttendancePayrollExportErrorCode, message: string) {
    super(message);
    this.name = 'AttendancePayrollExportError';
  }
}
