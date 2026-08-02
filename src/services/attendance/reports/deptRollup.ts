/**
 * dept-rollup report (PRD-061 FR-REPORT-DR-*).
 *
 * One row per department over the requested date range:
 *   headcount, total_hours, ot_hours, avg_hours_per_head,
 *   exceptions_count, total_wage.
 *
 * Headcount is the count of distinct staff that had at least one
 * attendance row in the window — not the headcount of the dept on the
 * end date — so an HR manager can see "people who actually worked"
 * rather than the org-chart total.
 */

import { sql } from '@/lib/db-pool';
import { buildBaseWhere, makeParamBuilder } from './sqlHelpers';
import { ReportTooLargeError, REPORT_ROW_CAP } from './runner';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'department', label: 'Department' },
  { key: 'headcount', label: 'Active staff', align: 'right', format: 'integer' },
  { key: 'total_hours', label: 'Total hours', align: 'right', format: 'number' },
  { key: 'ot_hours', label: 'OT hours', align: 'right', format: 'number' },
  { key: 'avg_hours_per_head', label: 'Avg hrs/head', align: 'right', format: 'number' },
  { key: 'exceptions_count', label: 'Exceptions', align: 'right', format: 'integer' },
  { key: 'total_wage_rand', label: 'Wage (R)', align: 'right', format: 'currency_rand' },
];

interface Row extends Record<string, unknown> {
  department: string | null;
  headcount: number;
  total_hours: string;
  ot_hours: string;
  exceptions_count: number;
  total_wage_cents: string | null;
}

export async function runDeptRollup(input: ReportInput): Promise<ReportRunResult> {
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: COLUMNS, notes: ['Date range is required.'] };
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
    employmentStaffAlias: 's',
  });
  // Pre-aggregate unresolved exceptions per (staff_id, work_date) to eliminate
  // the correlated per-row subquery. Date-range bound mirrors outer WHERE.
  const dateFromP = pb.next(input.dateFrom);
  const dateToP   = pb.next(input.dateTo);
  const text = `
    WITH ex AS (
      SELECT xe.staff_id, xe.work_date, COUNT(*)::int AS cnt
      FROM attendance_exceptions x
      JOIN attendance_entries xe ON xe.id = x.entry_id
      WHERE x.resolved_at IS NULL
        AND xe.work_date >= ${dateFromP}::date
        AND xe.work_date <= ${dateToP}::date
      GROUP BY xe.staff_id, xe.work_date
    )
    SELECT
      COALESCE(s.department, '(unassigned)')       AS department,
      COUNT(DISTINCT ds.staff_id)::int             AS headcount,
      COALESCE(SUM(ds.regular_hrs + ds.overtime_hrs), 0)::text AS total_hours,
      COALESCE(SUM(ds.overtime_hrs), 0)::text      AS ot_hours,
      COALESCE(SUM(ex.cnt), 0)::int                AS exceptions_count,
      COALESCE(SUM(ds.wage_amount_cents), 0)::text AS total_wage_cents
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    LEFT JOIN ex ON ex.staff_id = ds.staff_id AND ex.work_date = ds.work_date
    WHERE ${where}
    GROUP BY s.department
    ORDER BY department ASC
    LIMIT ${pb.next(REPORT_ROW_CAP + 1)}
  `;
  const rows = await sql.query<Row>(text, pb.params);
  if (rows.length > REPORT_ROW_CAP) {
    throw new ReportTooLargeError(rows.length);
  }
  let nullWage = 0;
  const out = rows.map((r) => {
    const total = Number(r.total_hours);
    const wageCents = r.total_wage_cents === null ? null : Number(r.total_wage_cents);
    if (wageCents === null) nullWage += 1;
    return {
      department: r.department ?? '(unassigned)',
      headcount: r.headcount,
      total_hours: total,
      ot_hours: Number(r.ot_hours),
      avg_hours_per_head: r.headcount > 0 ? Number((total / r.headcount).toFixed(2)) : 0,
      exceptions_count: r.exceptions_count,
      total_wage_rand: wageCents === null ? 0 : wageCents / 100,
    };
  });
  const notes: string[] = [];
  if (nullWage > 0) {
    notes.push(`${nullWage} row(s) had no wage amount (rate not captured at clock-in).`);
  }
  return { rows: out, columns: COLUMNS, notes };
}
