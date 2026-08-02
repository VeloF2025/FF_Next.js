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
