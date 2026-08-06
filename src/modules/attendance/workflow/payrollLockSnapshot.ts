import type { TxnClient } from '@/lib/db-pool';
import {
  employmentEffectivePredicate,
  expectedAttendanceDayPredicate,
} from '@/services/attendance/employmentUniverse';
import { assertApprovedBucketInvariant } from '@/services/attendance/policy/approvedBuckets';
import type { AttendanceClassification } from '@/services/attendance/policy/types';
import {
  PAYROLL_LOCK_SNAPSHOT_VERSION, type PayrollLockSnapshot,
  type PayrollLockSnapshotRow,
} from '@/services/attendance/payroll/types';

export interface SnapshotSourceRow extends Record<string, unknown> {
  staff_id: string; employee_id: string | null; full_name: string; work_date: string;
  expected_day: boolean;
  result_version: string | number; approved_regular_hrs: string | number | null;
  approved_overtime_hrs: string | number | null; approved_sunday_hrs: string | number | null;
  approved_holiday_hrs: string | number | null; leave_hrs: string | number | null;
  unpaid_hrs: string | number | null; attendance_classification: string | null;
  project_id: string | null; site_id: string | null;
}

export async function readPayrollSnapshotSources(
  tx: TxnClient, from: string, to: string,
): Promise<SnapshotSourceRow[]> {
  return tx.query<SnapshotSourceRow>(`/* attendance:payroll-lock-snapshot */
    WITH workdays AS (
      SELECT day::date AS work_date
      FROM generate_series($1::date, $2::date, '1 day') day
      WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 6
    ), expected AS (
      SELECT s.id AS staff_id, w.work_date
      FROM staff s CROSS JOIN workdays w
      WHERE ${expectedAttendanceDayPredicate('s', 'w.work_date')}
    )
    SELECT ds.staff_id, s.employee_id,
      TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
      TO_CHAR(ds.work_date, 'YYYY-MM-DD') AS work_date,
      (expected.staff_id IS NOT NULL) AS expected_day, ds.result_version,
      ds.approved_regular_hrs, ds.approved_overtime_hrs, ds.approved_sunday_hrs,
      ds.approved_holiday_hrs, ds.leave_hrs, ds.unpaid_hrs, ds.attendance_classification,
      project.project_id,
      COALESCE(approved_site.adjusted_site_geofence_id, evidence.site_geofence_id) AS site_id
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    LEFT JOIN expected ON expected.staff_id = ds.staff_id AND expected.work_date = ds.work_date
    LEFT JOIN LATERAL (
      SELECT e.id AS entry_id, e.site_geofence_id, e.vehicle_assignment_id
      FROM attendance_entries e
      WHERE e.staff_id = ds.staff_id AND e.work_date = ds.work_date
      ORDER BY e.clock_in_at, e.id LIMIT 1 FOR SHARE OF e
    ) evidence ON true
    LEFT JOIN LATERAL (
      SELECT aa.adjusted_site_geofence_id
      FROM attendance_adjustments aa
      WHERE aa.entry_id = evidence.entry_id AND aa.status = 'approved'
        AND aa.adjusted_site_geofence_id IS NOT NULL
      ORDER BY aa.reviewed_at DESC NULLS LAST, aa.updated_at DESC, aa.id DESC LIMIT 1
    ) approved_site ON true
    LEFT JOIN LATERAL (
      SELECT va.fleet_vehicle_id FROM vehicle_assignments va
      WHERE va.id = evidence.vehicle_assignment_id FOR SHARE OF va
    ) vehicle ON true
    LEFT JOIN LATERAL (
      SELECT fvpa.project_id FROM fleet_vehicle_project_assignments fvpa
      WHERE fvpa.vehicle_id = vehicle.fleet_vehicle_id
        AND fvpa.assigned_date <= ds.work_date
        AND (fvpa.returned_date IS NULL OR fvpa.returned_date >= ds.work_date)
      ORDER BY fvpa.assigned_date DESC, fvpa.id LIMIT 1 FOR SHARE OF fvpa
    ) project ON true
    WHERE ds.work_date BETWEEN $1::date AND $2::date AND ds.result_status = 'approved'
      AND ${employmentEffectivePredicate('s', 'ds.work_date')}
    ORDER BY ds.staff_id, ds.work_date FOR UPDATE OF ds, s`, [from, to]);
}

export function buildPayrollLockSnapshot(
  source: SnapshotSourceRow[], lockVersion: number,
): PayrollLockSnapshot {
  if (!Number.isInteger(lockVersion) || lockVersion < 1) throw new Error('Invalid payroll lock version');
  const rows = source.map((row) => snapshotRow(row, lockVersion))
    .sort((a, b) => a.staff_id.localeCompare(b.staff_id) || a.work_date.localeCompare(b.work_date));
  return { version: PAYROLL_LOCK_SNAPSHOT_VERSION, rows };
}

function snapshotRow(row: SnapshotSourceRow, lockVersion: number): PayrollLockSnapshotRow {
  const currentVersion = Number(row.result_version);
  if (!row.staff_id?.trim() || !row.employee_id?.trim() || !row.full_name?.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.work_date) ||
      !Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error('Payroll lock snapshot has incomplete staff or result identity');
  }
  if (row.attendance_classification !== null && ![
    'approved_leave', 'sick_leave', 'site_shutdown_weather',
    'public_holiday', 'unauthorised_absence',
  ].includes(row.attendance_classification)) throw new Error('Payroll lock snapshot has invalid classification');
  const buckets = {
    regular: numericHours(row.approved_regular_hrs),
    overtime: numericHours(row.approved_overtime_hrs),
    sunday: numericHours(row.approved_sunday_hrs),
    holiday: numericHours(row.approved_holiday_hrs),
    leave: numericHours(row.leave_hrs),
    unpaid: numericHours(row.unpaid_hrs),
  };
  assertApprovedBucketInvariant(row.attendance_classification as AttendanceClassification | null, buckets);
  return {
    staff_id: row.staff_id, employee_id: row.employee_id, full_name: row.full_name,
    work_date: row.work_date,
    approved_regular_hrs: hours(row.approved_regular_hrs),
    approved_overtime_hrs: hours(row.approved_overtime_hrs),
    approved_sunday_hrs: hours(row.approved_sunday_hrs),
    approved_holiday_hrs: hours(row.approved_holiday_hrs),
    leave_hrs: hours(row.leave_hrs), unpaid_hrs: hours(row.unpaid_hrs),
    attendance_classification: row.attendance_classification,
    project_id: row.project_id ?? null, site_id: row.site_id ?? null,
    result_version: currentVersion + 1, locked_period_version: lockVersion,
  };
}

function numericHours(value: unknown): number {
  const normalised = hours(value);
  return Number(normalised);
}

function hours(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    throw new Error('Payroll lock snapshot has invalid approved hours');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) {
    throw new Error('Payroll lock snapshot has invalid approved hours');
  }
  return parsed.toFixed(2);
}
