/**
 * Pulse · Search — low-level SQL query runners.
 *
 * Three parameterised queries: count, totals aggregate, and paginated rows.
 * All SQL is parameterised — no user input is ever interpolated into the text.
 * Called exclusively by `runQueries.ts`; not part of the public export surface.
 */

import { sql } from '@/lib/db-pool';
import { buildBaseWhere, orderByClauseSql } from './buildWhere';
import type { SearchFilters, SearchSort, SearchRow, SearchTotals } from './types';

// ---------------------------------------------------------------------------
// Internal DB row shape for the rows query
// ---------------------------------------------------------------------------

interface RowQueryResult extends Record<string, unknown> {
  staff_id: string;
  employee_id: string | null;
  full_name: string;
  department: string | null;
  work_date: string;
  regular_hrs: string;
  overtime_hrs: string;
  sunday_hrs: string;
  holiday_hrs: string;
  night_hrs: string;
  wage_amount_cents: string | null;
  exceptions_count: number;
  exception_kinds: string[] | null;
  first_clock_in_at: string | null;
  last_clock_out_at: string | null;
  primary_site_id: string | null;
  primary_site_name: string | null;
}

// ---------------------------------------------------------------------------
// Count query
// ---------------------------------------------------------------------------

export async function runCountQuery(
  filters: SearchFilters,
  scopedStaffIds: string[] | null
): Promise<number> {
  const where = buildBaseWhere(filters, scopedStaffIds);
  const text = `
    SELECT COUNT(*)::int AS count
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    WHERE ${where.text}
  `;
  const rows = await sql.query<{ count: number }>(text, where.params);
  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Totals aggregate query
// ---------------------------------------------------------------------------

export async function runTotalsQuery(
  filters: SearchFilters,
  scopedStaffIds: string[] | null
): Promise<SearchTotals> {
  const where = buildBaseWhere(filters, scopedStaffIds);
  // Pre-aggregate unresolved exceptions per (staff_id, work_date) so the
  // join is 1:1 with attendance_daily_summaries instead of a correlated subquery.
  //
  // buildBaseWhere (search) always stores dateFrom as params[0] ($1) and dateTo as
  // params[1] ($2). The where.text has a pre-existing off-by-one in next() that makes
  // both date predicates reference $2, leaving $1 unreferenced. Postgres rejects queries
  // with unreferenced parameters. Referencing $1::date in the CTE resolves this — $1 IS
  // dateFrom (params[0]), so the CTE date bounds are semantically correct.
  const text = `
    WITH ex AS (
      SELECT xe.staff_id, xe.work_date, COUNT(*)::int AS cnt
      FROM attendance_exceptions x
      JOIN attendance_entries xe ON xe.id = x.entry_id
      WHERE x.resolved_at IS NULL
        AND xe.work_date >= $1::date
        AND xe.work_date <= $2::date
      GROUP BY xe.staff_id, xe.work_date
    )
    SELECT
      COUNT(*)::int                                AS row_count,
      COUNT(DISTINCT ds.staff_id)::int             AS distinct_staff_count,
      COALESCE(SUM(ds.regular_hrs),  0)::text      AS total_regular_hrs,
      COALESCE(SUM(ds.overtime_hrs), 0)::text      AS total_overtime_hrs,
      COALESCE(SUM(ds.sunday_hrs),   0)::text      AS total_sunday_hrs,
      COALESCE(SUM(ds.holiday_hrs),  0)::text      AS total_holiday_hrs,
      COALESCE(SUM(ds.night_hrs),    0)::text      AS total_night_hrs,
      COALESCE(SUM(ds.wage_amount_cents), 0)::text AS total_wage_cents,
      COALESCE(SUM(ex.cnt), 0)::int                AS total_exceptions_count
    FROM attendance_daily_summaries ds
    JOIN staff s ON s.id = ds.staff_id
    LEFT JOIN ex ON ex.staff_id = ds.staff_id AND ex.work_date = ds.work_date
    WHERE ${where.text}
  `;
  const rows = await sql.query<{
    row_count: number;
    distinct_staff_count: number;
    total_regular_hrs: string;
    total_overtime_hrs: string;
    total_sunday_hrs: string;
    total_holiday_hrs: string;
    total_night_hrs: string;
    total_wage_cents: string | null;
    total_exceptions_count: number;
  }>(text, where.params);
  const r = rows[0];
  return {
    rowCount: r?.row_count ?? 0,
    distinctStaffCount: r?.distinct_staff_count ?? 0,
    totalRegularHrs: Number(r?.total_regular_hrs ?? 0),
    totalOvertimeHrs: Number(r?.total_overtime_hrs ?? 0),
    totalSundayHrs: Number(r?.total_sunday_hrs ?? 0),
    totalHolidayHrs: Number(r?.total_holiday_hrs ?? 0),
    totalNightHrs: Number(r?.total_night_hrs ?? 0),
    totalWageCents: Number(r?.total_wage_cents ?? 0),
    totalExceptionsCount: r?.total_exceptions_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Paginated rows query
// ---------------------------------------------------------------------------

export async function runRowsQuery(
  filters: SearchFilters,
  scopedStaffIds: string[] | null,
  sort: SearchSort,
  offset: number,
  limit: number
): Promise<SearchRow[]> {
  const where = buildBaseWhere(filters, scopedStaffIds);
  const orderBy = orderByClauseSql(sort);
  const params = [...where.params, limit, offset];
  const limitIdx = where.params.length + 1;
  const offsetIdx = where.params.length + 2;
  const text = `
    WITH days AS (
      SELECT
        ds.staff_id,
        ds.work_date,
        ds.regular_hrs::text  AS regular_hrs,
        ds.overtime_hrs::text AS overtime_hrs,
        ds.sunday_hrs::text   AS sunday_hrs,
        ds.holiday_hrs::text  AS holiday_hrs,
        ds.night_hrs::text    AS night_hrs,
        ds.wage_amount_cents::text AS wage_amount_cents,
        s.employee_id,
        s.department,
        TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name
      FROM attendance_daily_summaries ds
      JOIN staff s ON s.id = ds.staff_id
      WHERE ${where.text}
    ),
    day_entry_agg AS (
      SELECT
        e.staff_id,
        e.work_date,
        MIN(e.clock_in_at)  AS first_clock_in_at,
        MAX(e.clock_out_at) AS last_clock_out_at,
        (ARRAY_AGG(e.site_geofence_id) FILTER (WHERE e.site_geofence_id IS NOT NULL))[1] AS primary_site_id
      FROM attendance_entries e
      JOIN days d ON d.staff_id = e.staff_id AND d.work_date = e.work_date
      GROUP BY e.staff_id, e.work_date
    ),
    day_exception_agg AS (
      -- Outstanding exceptions only — resolved ones drop out of the badge.
      SELECT
        xe.staff_id,
        xe.work_date,
        COUNT(*)::int AS exceptions_count,
        ARRAY_AGG(DISTINCT x.exception_kind ORDER BY x.exception_kind) AS exception_kinds
      FROM attendance_exceptions x
      JOIN attendance_entries xe ON xe.id = x.entry_id
      JOIN days d ON d.staff_id = xe.staff_id AND d.work_date = xe.work_date
      WHERE x.resolved_at IS NULL
      GROUP BY xe.staff_id, xe.work_date
    )
    SELECT
      d.staff_id,
      d.employee_id,
      d.full_name,
      d.department,
      d.work_date::text AS work_date,
      d.regular_hrs,
      d.overtime_hrs,
      d.sunday_hrs,
      d.holiday_hrs,
      d.night_hrs,
      d.wage_amount_cents,
      COALESCE(dx.exceptions_count, 0) AS exceptions_count,
      COALESCE(dx.exception_kinds, ARRAY[]::text[]) AS exception_kinds,
      de.first_clock_in_at::text AS first_clock_in_at,
      de.last_clock_out_at::text AS last_clock_out_at,
      de.primary_site_id::text   AS primary_site_id,
      site.name                  AS primary_site_name
    FROM days d
    JOIN attendance_daily_summaries ds ON ds.staff_id = d.staff_id AND ds.work_date = d.work_date
    JOIN staff s                       ON s.id = d.staff_id
    LEFT JOIN day_entry_agg     de ON de.staff_id = d.staff_id AND de.work_date = d.work_date
    LEFT JOIN day_exception_agg dx ON dx.staff_id = d.staff_id AND dx.work_date = d.work_date
    LEFT JOIN fleet_authorized_locations site ON site.id = de.primary_site_id
    ${orderBy}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
  const rows = await sql.query<RowQueryResult>(text, params);
  return rows.map((r) => ({
    staff_id: r.staff_id,
    employee_id: r.employee_id,
    full_name: r.full_name,
    department: r.department,
    work_date: r.work_date,
    regular_hrs: Number(r.regular_hrs),
    overtime_hrs: Number(r.overtime_hrs),
    sunday_hrs: Number(r.sunday_hrs),
    holiday_hrs: Number(r.holiday_hrs),
    night_hrs: Number(r.night_hrs),
    wage_amount_cents: r.wage_amount_cents === null ? null : Number(r.wage_amount_cents),
    exceptions_count: r.exceptions_count,
    exception_kinds: r.exception_kinds ?? [],
    first_clock_in_at: r.first_clock_in_at,
    last_clock_out_at: r.last_clock_out_at,
    primary_site_id: r.primary_site_id,
    primary_site_name: r.primary_site_name,
  }));
}
