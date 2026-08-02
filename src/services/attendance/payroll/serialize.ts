import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import {
  ApprovedBucketInvariantError,
  assertApprovedBucketInvariant,
} from '@/services/attendance/policy/approvedBuckets';
import type { AttendanceClassification } from '@/services/attendance/policy/types';

import {
  AttendancePayrollExportError, PAYROLL_EXPORT_COLUMNS,
  type PayrollExportFormat, type PayrollExportRow, type PayrollExportTotals,
  type PayrollLockSnapshotRow,
} from './types';

const TOTAL_COLUMNS = [
  'ordinary_hours', 'overtime_hours', 'sunday_hours', 'public_holiday_hours',
  'approved_leave_hours', 'sick_leave_hours', 'unpaid_hours',
] as const;

export function mapLockedPayrollRows(
  source: PayrollLockSnapshotRow[], lockVersion: number,
): PayrollExportRow[] {
  if (source.length === 0) fail('empty_period', 'The active lock contains no locked attendance results');
  return source.map((row) => mapRow(row, lockVersion));
}

function mapRow(row: PayrollLockSnapshotRow, lockVersion: number): PayrollExportRow {
  if (positiveInteger(row.locked_period_version) !== lockVersion) {
    fail('invalid_locked_results', 'Locked attendance results contain a missing or mixed lock version');
  }
  const resultVersion = positiveInteger(row.result_version);
  if (!row.staff_id?.trim() || !row.employee_id?.trim() || !row.full_name?.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.work_date) || resultVersion === null) {
    fail('invalid_staff_identity', 'A locked attendance result has incomplete staff or audit identity');
  }
  const classification = row.attendance_classification;
  if (classification !== null && ![
    'approved_leave', 'sick_leave', 'site_shutdown_weather',
    'public_holiday', 'unauthorised_absence',
  ].includes(classification)) {
    fail('invalid_locked_results', 'A locked attendance result has an invalid classification');
  }
  const regular = hundredths(row.approved_regular_hrs, 'approved ordinary hours');
  const overtime = hundredths(row.approved_overtime_hrs, 'approved overtime hours');
  const sunday = hundredths(row.approved_sunday_hrs, 'approved Sunday hours');
  const holiday = hundredths(row.approved_holiday_hrs, 'approved public-holiday hours');
  const leave = hundredths(row.leave_hrs, 'approved leave hours');
  const unpaid = hundredths(row.unpaid_hrs, 'unpaid hours');
  validateBuckets(classification, { regular, overtime, sunday, holiday, leave, unpaid });
  const classifiedAbsence = ['approved_leave', 'sick_leave', 'public_holiday',
    'unauthorised_absence'].includes(classification ?? '');
  return {
    staff_id: row.staff_id, employee_id: row.employee_id, full_name: row.full_name,
    work_date: row.work_date,
    ordinary_hours: decimal(classifiedAbsence ? 0 : regular), overtime_hours: decimal(overtime),
    sunday_hours: decimal(sunday), public_holiday_hours: decimal(holiday),
    approved_leave_hours: decimal(classification === 'approved_leave' ? leave : 0),
    sick_leave_hours: decimal(classification === 'sick_leave' ? leave : 0),
    unpaid_hours: decimal(unpaid), project_id: row.project_id ?? '', site_id: row.site_id ?? '',
    lock_version: String(lockVersion),
    audit_reference: `attendance:${row.staff_id}:${row.work_date}:result-v${resultVersion}:lock-v${lockVersion}`,
  };
}

interface Buckets { regular: number; overtime: number; sunday: number; holiday: number; leave: number; unpaid: number }
function validateBuckets(classification: string | null, h: Buckets): void {
  try {
    assertApprovedBucketInvariant(classification as AttendanceClassification | null, {
      regular: h.regular / 100,
      overtime: h.overtime / 100,
      sunday: h.sunday / 100,
      holiday: h.holiday / 100,
      leave: h.leave / 100,
      unpaid: h.unpaid / 100,
    });
  } catch (error) {
    if (error instanceof ApprovedBucketInvariantError) {
      fail('invalid_locked_results', error.message);
    }
    throw error;
  }
}

export function payrollTotals(rows: PayrollExportRow[]): PayrollExportTotals {
  const totals = Object.fromEntries(TOTAL_COLUMNS.map((column) => [column, 0])) as
    Record<typeof TOTAL_COLUMNS[number], number>;
  for (const row of rows) {
    for (const column of TOTAL_COLUMNS) totals[column] += hundredths(row[column], column);
  }
  return Object.fromEntries(TOTAL_COLUMNS.map((column) => [column, decimal(totals[column])])) as
    PayrollExportTotals;
}

export function serializePayrollExport(args: {
  format: PayrollExportFormat; rows: PayrollExportRow[]; lockedAt: string;
}): { bytes: Buffer; sha256: string } {
  const bytes = args.format === 'csv' ? csvBytes(args.rows) : xlsxBytes(args.rows, args.lockedAt);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function csvBytes(rows: PayrollExportRow[]): Buffer {
  const lines = [PAYROLL_EXPORT_COLUMNS.join(',')];
  for (const row of rows) lines.push(PAYROLL_EXPORT_COLUMNS.map((key) => escapeCsv(row[key])).join(','));
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

function xlsxBytes(rows: PayrollExportRow[], lockedAt: string): Buffer {
  const timestamp = new Date(lockedAt);
  if (Number.isNaN(timestamp.getTime())) fail('export_version_conflict', 'The active lock timestamp is invalid');
  const values = [Array.from(PAYROLL_EXPORT_COLUMNS), ...rows.map((row) =>
    PAYROLL_EXPORT_COLUMNS.map((column) => row[column]))];
  const worksheet = XLSX.utils.aoa_to_sheet(values);
  for (let index = 0; index < PAYROLL_EXPORT_COLUMNS.length; index += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c: index })];
    if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '16324F' } },
      alignment: { horizontal: 'center' } };
  }
  worksheet['!cols'] = PAYROLL_EXPORT_COLUMNS.map((column) => ({ wch: Math.max(column.length + 2, 14) }));
  worksheet['!autofilter'] = { ref: worksheet['!ref'] ?? 'A1:O1' };
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'FibreFlow locked payroll hours', Subject: 'Approved attendance hour categories',
    Author: 'FibreFlow', Company: 'Velocity Fibre', CreatedDate: timestamp, ModifiedDate: timestamp,
  };
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll Hours');
  return XLSX.write(workbook, {
    type: 'buffer', bookType: 'xlsx', compression: true, cellStyles: true,
  }) as Buffer;
}

function escapeCsv(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function hundredths(value: unknown, label: string): number {
  const text = typeof value === 'number' ? value.toFixed(2) : String(value ?? '');
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) fail('invalid_locked_results', `Invalid ${label} in locked attendance result`);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const result = whole * 100 + fraction;
  if (result > 2400) fail('invalid_locked_results', `Invalid ${label} in locked attendance result`);
  return result;
}

function decimal(value: number): string {
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

function fail(code: ConstructorParameters<typeof AttendancePayrollExportError>[0], message: string): never {
  throw new AttendancePayrollExportError(code, message);
}
