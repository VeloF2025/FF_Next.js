import { approvedAccountPredicate } from '@/lib/staff/hrVisibilityFilters';

/**
 * Canonical attendance worker/day universe.
 *
 * `staffAlias` and `workDateRef` must be hard-coded SQL identifiers supplied
 * by the caller, never request or database values.
 */
export function employmentEffectivePredicate(
  staffAlias: string,
  workDateRef: string,
): string {
  return [
    `(${staffAlias}.is_active = true OR ${staffAlias}.is_active IS NULL OR ${staffAlias}.end_date IS NOT NULL)`,
    `(${staffAlias}.join_date IS NULL OR ${staffAlias}.join_date::date <= ${workDateRef})`,
    `(${staffAlias}.end_date IS NULL OR ${staffAlias}.end_date::date >= ${workDateRef})`,
    approvedAccountPredicate(staffAlias),
  ].join(' AND ');
}

/**
 * Canonical EXPECTED-day universe: staff who are expected to clock in.
 *
 * Use this for every `staff CROSS JOIN workdays` expectation CTE, and ONLY
 * those. It is `employmentEffectivePredicate` plus `attendance_tracked`.
 *
 * The distinction matters and is not cosmetic. `attendance_tracked` scopes who
 * is expected to appear; it must never scope who gets *processed*. Queries that
 * read existing rows — entries, summaries, exceptions, adjustments — must keep
 * using `employmentEffectivePredicate` alone, so an untracked staff member who
 * does clock in is still reconciled, still approved, and still paid.
 *
 * Every expectation site must use this together, because they are compared
 * against each other. `metricsSql()` gates `readyToLock` on
 * `expectedDayCount === approvedDayCount`, and `blockersSql()` raises
 * `missing_daily_result` for expected days with no summary row. If one site
 * counts a staff member as expected while the reconciler no longer projects a
 * day for them, that day can never be satisfied and the week can never lock.
 */
export function expectedAttendanceDayPredicate(
  staffAlias: string,
  workDateRef: string,
): string {
  return `${staffAlias}.attendance_tracked = true AND ${employmentEffectivePredicate(staffAlias, workDateRef)}`;
}
