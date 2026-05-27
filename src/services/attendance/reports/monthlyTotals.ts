/**
 * monthly-totals report (PRD-061 FR-REPORT-MT-*).
 *
 * One row per active staff for the requested month. Sums hours, OT,
 * exception count, and wage from `attendance_daily_summaries`. Late
 * and no-show counts are reported as 0 today — the canonical
 * `attendance_exceptions.exception_kind` enum doesn't carry those
 * tags (Phase A deferral). The columns ship in the result anyway so
 * the spreadsheet shape stays stable when Phase C2 lights them up.
 */

import { sql } from '@/lib/db-pool';
import { buildBaseWhere, makeParamBuilder } from './sqlHelpers';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'staff_id', label: 'Staff ID' },
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'full_name', label: 'Full name' },
  { key: 'department', label: 'Department' },
  { key: 'days_worked', label: 'Days worked', align: 'right', format: 'integer' },
  { key: 'total_hours', label: 'Total hours', align: 'right', format: 'number' },
  { key: 'ot_hours', label: 'OT hours', align: 'right', format: 'number' },
  { key: 'sunday_hours', label: 'Sunday hrs', align: 'right', format: 'number' },
  { key: 'holiday_hours', label: 'Holiday hrs', align: 'right', format: 'number' },
  { key: 'exceptions_count', label: 'Exceptions', align: 'right', format: 'integer' },
  { key: 'late_count', label: 'Late (P-C2)', align: 'right', format: 'integer' },
  { key: 'no_show_count', label: 'No-show (P-C2)', align: 'right', format: 'integer' },
  { key: 'total_wage_rand', label: 'Wage (R)', align: 'right', format: 'currency_rand' },
];

interface Row extends Record<string, unknown> {
  staff_id: string;
  employee_id: string | null;
  full_name: string;
  department: string | null;
  days_worked: number;
  total_hours: string;
  ot_hours: string;
  sunday_hours: string;
  holiday_hours: string;
  exceptions_count: number;
  total_wage_cents: string | null;
}

export async function runMonthlyTotals(input: ReportInput): Promise<ReportRunResult> {
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: COLUMNS, notes: ['Month is required.'] };
  }
  const pb = makeParamBuilder();
  const where = buildBaseWhere({
    pb,
    scopedStaffIds: input.scopedStaffIds,
    staffIdRef: 'ds.staff_id',
    workDateRef: 'ds.work_date',
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    departments: input.departments,
    deptRef: 's.department',
    activeStaffRefs: { isActive: 's.is_active', endDate: 's.end_date' },
  });
  const siteFilterSql = input.siteIds.length > 0
    ? ` AND EXISTS (
        SELECT 1 FROM attendance_entries e
         WHERE e.staff_id = ds.staff_id
           AND e.work_date = ds.work_date
           AND e.site_geofence_id = ANY(${pb.next(input.siteIds)}::uuid[]))`
    : '';

  const text = `
    SELECT
      ds.staff_id,
      s.employee_id,
      TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
      s.department,
      COUNT(*)::int                                AS days_worked,
      COALESCE(SUM(ds.regular_hrs + ds.overtime_hrs), 0)::text AS total_hours,
      COALESCE(SUM(ds.overtime_hrs), 0)::text      AS ot_hours,
      COALESCE(SUM(ds.sunday_hrs),   0)::text      AS sunday_hours,
      COALESCE(SUM(ds.holiday_hrs),  0)::text      AS holiday_hours,
      COALESCE(SUM((
        SELECT COUNT(*) FROM attendance_exceptions x
        JOIN attendance_entries xe ON xe.id = x.entry_id
        WHERE xe.staff_id = ds.staff_id
          AND xe.work_date = ds.work_date
          AND x.resolved_at IS NULL
      )), 0)::int                                  AS exceptions_count,
      COALESCE(SUM(ds.wage_amount_cents), 0)::text AS total_wage_cents
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    WHERE ${where}${siteFilterSql}
    GROUP BY ds.staff_id, s.employee_id, s.first_name, s.last_name, s.department
    ORDER BY full_name ASC
  `;
  const rows = await sql.query<Row>(text, pb.params);
  let nullWage = 0;
  const notes: string[] = [];
  const out = rows.map((r) => {
    const wageCents = r.total_wage_cents === null ? null : Number(r.total_wage_cents);
    if (wageCents === null || wageCents === 0) nullWage += 1;
    return {
      staff_id: r.staff_id,
      employee_id: r.employee_id ?? '',
      full_name: r.full_name,
      department: r.department ?? '',
      days_worked: r.days_worked,
      total_hours: Number(r.total_hours),
      ot_hours: Number(r.ot_hours),
      sunday_hours: Number(r.sunday_hours),
      holiday_hours: Number(r.holiday_hours),
      exceptions_count: r.exceptions_count,
      late_count: 0,
      no_show_count: 0,
      total_wage_rand: wageCents === null ? 0 : wageCents / 100,
    };
  });
  if (nullWage > 0) {
    notes.push(`${nullWage} row(s) had no wage amount (rate not captured at clock-in).`);
  }
  notes.push('late_count / no_show_count are reported as 0 — the underlying exception kinds ship in Phase C2.');
  return { rows: out, columns: COLUMNS, notes };
}
