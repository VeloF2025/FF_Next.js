/**
 * Pulse · Search — scope resolution.
 *
 * Translates the viewer's auth role into a set of allowed staff IDs (or null
 * for org-wide). Super_admin / admin always see the full dataset; every other
 * role is intersected with `staffIdsSupervisedBy` so a client-supplied
 * `staffIds=` cannot escape supervisor scope (FR-SEARCH-08).
 *
 * `resolveScope` is an async DB read. The result is passed to `buildWhere`
 * and `runQueries` which are synchronous / parameterised-only.
 */

import { staffIdsSupervisedBy } from '../supervisorScope';
import { getStaffIdForUser } from '@/services/staff/staffAccessService';
import type { ResolvedScope, SearchFilters } from './types';

export type { ResolvedScope };

/**
 * Resolve the viewer's scope. Super_admin / admin always get the unfiltered
 * org-wide treatment (PRD §3.1, FR-SEARCH-08); every other role's results
 * are intersected with `staffIdsSupervisedBy`. A user without a linked
 * staff record (e.g. an admin user that was never linked to a staff row)
 * gets `no_scope` — empty result, distinct from "your filters matched
 * nothing" so the UI can show the right empty state (FR-SEARCH-12).
 */
export interface ScopePrincipal {
  id: string;
  role: string;
}

export async function resolveScope(user: ScopePrincipal): Promise<ResolvedScope> {
  if (user.role === 'super_admin' || user.role === 'admin') {
    return { allowedStaffIds: null, note: { kind: 'orgwide' } };
  }
  const viewerStaffId = await getStaffIdForUser(user.id);
  if (!viewerStaffId) {
    return {
      allowedStaffIds: [],
      note: {
        kind: 'no_scope',
        reason: 'Your account is not linked to a staff record; no rows in scope.',
      },
    };
  }
  const ids = await staffIdsSupervisedBy(viewerStaffId);
  return {
    allowedStaffIds: ids,
    note: { kind: 'scoped', staffCount: ids.length },
  };
}

/**
 * Intersect user-supplied `filters.staffIds` with the role-derived scope.
 * If the user supplied no staffIds, the scope alone constrains; if they
 * supplied some, we keep only the overlap so a manager can't expand
 * their visibility by listing IDs outside their reports.
 */
export function effectiveStaffIds(
  filters: SearchFilters,
  scope: ResolvedScope
): string[] | null {
  if (scope.allowedStaffIds === null) {
    return filters.staffIds.length > 0 ? filters.staffIds : null;
  }
  if (filters.staffIds.length === 0) return scope.allowedStaffIds;
  const allowed = new Set(scope.allowedStaffIds);
  return filters.staffIds.filter((id) => allowed.has(id));
}
