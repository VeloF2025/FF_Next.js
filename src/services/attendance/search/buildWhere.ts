/**
 * Pulse · Search — WHERE clause construction.
 *
 * Builds a parameterised WHERE clause from the validated `SearchFilters` and
 * the resolved scope. The clause always begins with the date-range predicates
 * so it is never empty — callers can safely inline with `WHERE ${text}`.
 *
 * CLAUDE.md rule: parameterised SQL only. Never string-interpolate user input.
 * All values go through the `params` array as $N bindings.
 */

import { approvedAccountPredicate } from '@/lib/staff/hrVisibilityFilters';
import type { SearchFilters, SearchSort } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuiltWhere {
  /** Final SQL clause text without the leading WHERE keyword. */
  text: string;
  params: unknown[];
}

// ---------------------------------------------------------------------------
// buildBaseWhere
// ---------------------------------------------------------------------------

/**
 * Build the WHERE clause as $-bound text. Returned `text` always starts
 * with the date-range predicates, so it is never empty — callers can safely
 * inline with `WHERE ${text}`. Subsequent predicates are AND-joined; absent
 * filters are skipped entirely (no `AND TRUE` padding).
 *
 * Every query through this function joins `attendance_daily_summaries ds`
 * and `staff s` — the Rule P predicate (`approvedAccountPredicate`) refers to
 * `s.account_status` on that alias.
 */
export function buildBaseWhere(
  filters: SearchFilters,
  scopedStaffIds: string[] | null
): BuiltWhere {
  const parts: string[] = [];
  const params: unknown[] = [];

  // Reference $${params.length} *after* each push so the placeholder matches
  // the value just bound. The date range is pushed first and unconditionally,
  // so dateFrom is always $1 and dateTo always $2. (A `params.length + 1`
  // helper here was off-by-one: it made the dateFrom predicate reference $2
  // too, collapsing every range to its last day — a real search regression.)
  params.push(filters.dateFrom);
  parts.push(`ds.work_date >= $${params.length}::date`);

  params.push(filters.dateTo);
  parts.push(`ds.work_date <= $${params.length}::date`);

  // Rule P — hide unapproved (pending) workers from attendance search/export.
  parts.push(approvedAccountPredicate('s'));

  if (scopedStaffIds !== null) {
    params.push(scopedStaffIds);
    parts.push(`ds.staff_id = ANY($${params.length}::uuid[])`);
  }
  if (filters.departments.length > 0) {
    // #2003: case-insensitive match so "civil" finds "Civil".
    params.push(filters.departments.map((d) => d.toLowerCase()));
    parts.push(`LOWER(s.department) = ANY($${params.length}::text[])`);
  }
  if (filters.daysOfWeek.length > 0) {
    params.push(filters.daysOfWeek);
    parts.push(`EXTRACT(DOW FROM ds.work_date)::int = ANY($${params.length}::int[])`);
  }
  if (filters.onlyWithOt) {
    parts.push(`ds.overtime_hrs > 0`);
  }
  if (filters.onlySundayHoliday) {
    parts.push(`(ds.sunday_hrs > 0 OR ds.holiday_hrs > 0)`);
  }
  if (filters.onlyActive) {
    // is_active is the soft-flag; end_date is the hard termination date.
    parts.push(`(s.is_active = true OR s.is_active IS NULL) AND s.end_date IS NULL`);
  }
  if (filters.siteIds.length > 0) {
    params.push(filters.siteIds);
    parts.push(`EXISTS (
      SELECT 1 FROM attendance_entries e
      WHERE e.staff_id = ds.staff_id
        AND e.work_date = ds.work_date
        AND e.site_geofence_id = ANY($${params.length}::uuid[])
    )`);
  }
  if (filters.exceptionKinds.length > 0) {
    // Match only unresolved exceptions — resolved ones drop out of the filter.
    params.push(filters.exceptionKinds);
    parts.push(`EXISTS (
      SELECT 1 FROM attendance_exceptions x
      JOIN attendance_entries xe ON xe.id = x.entry_id
      WHERE xe.staff_id = ds.staff_id
        AND xe.work_date = ds.work_date
        AND x.resolved_at IS NULL
        AND x.exception_kind = ANY($${params.length}::text[])
    )`);
  }

  return { text: parts.join('\n  AND '), params };
}

// ---------------------------------------------------------------------------
// ORDER BY clause
// ---------------------------------------------------------------------------

export function orderByClauseSql(sort: SearchSort): string {
  const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
  switch (sort.field) {
    case 'work_date':
      return `ORDER BY ds.work_date ${dir}, full_name ASC`;
    case 'full_name':
      return `ORDER BY full_name ${dir}, ds.work_date DESC`;
    case 'hours':
      return `ORDER BY (ds.regular_hrs + ds.overtime_hrs) ${dir}, ds.work_date DESC`;
    case 'overtime':
      return `ORDER BY ds.overtime_hrs ${dir}, ds.work_date DESC`;
    case 'department':
      return `ORDER BY s.department ${dir} NULLS LAST, full_name ASC`;
  }
}
