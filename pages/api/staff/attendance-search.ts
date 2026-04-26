/**
 * GET /api/staff/attendance-search
 * POST /api/staff/attendance-search   (POST is allowed for very long staffIds[]
 *                                      lists that don't fit in a querystring;
 *                                      body shape mirrors the query shape)
 *
 * Cross-staff, cross-period attendance Search — Pulse Phase A
 * (PRD-061 §7.1, FR-SEARCH-01..14).
 *
 * Returns:
 *   {
 *     rows:        SearchRow[],
 *     totals:      SearchTotals,
 *     scopeNote:   ScopeNote,
 *     pagination:  { page, pageSize, totalRows, hasMore }
 *   }
 *
 * RBAC: `people.staff.attendance.search` view. Scope is enforced at the
 * SQL layer — super_admin/admin always see org-wide, every other role's
 * row set is intersected with `staffIdsSupervisedBy(viewerStaffId)` so a
 * client-supplied `staffIds=` cannot escape supervisor scope.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import {
  parseFilters,
  parsePagination,
  parseSort,
  resolveScope,
  runSearch,
  ValidationError,
  type RawQuery,
} from '@/services/attendance/searchQueries';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
    return;
  }

  // POST: body is the same shape as the querystring; merge so a partial
  // body can still pull pagination from the querystring (a UI that posts
  // long staffIds while keeping the rest of the controls in the URL).
  const rawQuery: RawQuery = req.method === 'POST'
    ? { ...(req.query as RawQuery), ...((req.body as RawQuery) ?? {}) }
    : (req.query as RawQuery);

  const user = (req as AuthenticatedNextApiRequest).user;
  if (!user?.id) {
    apiResponse.unauthorized(res);
    return;
  }

  let filters;
  let pagination;
  let sort;
  try {
    filters = parseFilters(rawQuery);
    pagination = parsePagination(rawQuery);
    sort = parseSort(rawQuery);
  } catch (err) {
    if (err instanceof ValidationError) {
      apiResponse.badRequest(res, err.message);
      return;
    }
    throw err;
  }

  try {
    const scope = await resolveScope(user);
    const result = await runSearch({ filters, scope, pagination, sort });

    apiResponse.success(res, {
      rows: result.rows,
      totals: result.totals,
      scopeNote: result.scopeNote,
      pagination: result.pagination,
      filters,
      sort,
    });
  } catch (err) {
    log.error('[attendance-search] failed', {
      userId: user.id,
      role: user.role,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.search', 'view')(handler)
);
