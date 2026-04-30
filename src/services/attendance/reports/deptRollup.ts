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
    activeStaffRefs: { isActive: 's.is_active', endDate: 's.end_date' },
  });
  const text = `
    SELECT
      COALESCE(s.department, '(unassigned)')       AS department,
      COUNT(DISTINCT ds.staff_id)::int             AS headcount,
      COALESCE(SUM(ds.regular_hrs + ds.overtime_hrs), 0)::text AS total_hours,
      COALESCE(SUM(ds.overtime_hrs), 0)::text      AS ot_hours,
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
    WHERE ${where}
    GROUP BY s.department
    ORDER BY department ASC
  `;
  const rows = await sql.query<Row>(text, pb.params);
  return {
    rows: rows.map((r) => {
      const total = Number(r.total_hours);
      return {
        department: r.department ?? '(unassigned)',
        headcount: r.headcount,
        total_hours: total,
        ot_hours: Number(r.ot_hours),
        avg_hours_per_head: r.headcount > 0 ? Number((total / r.headcount).toFixed(2)) : 0,
        exceptions_count: r.exceptions_count,
        total_wage_rand: r.total_wage_cents === null ? 0 : Number(r.total_wage_cents) / 100,
      };
    }),
    columns: COLUMNS,
    notes: [],
  };
}
