/**
 * GET /api/reporting/action-items?state=open&assignee=…&olderThanDays=90
 *
 * The action-item backlog, aggregated. Returns counts, a per-assignee breakdown, the
 * extraction-vs-triage rate and a sample of the oldest items — not the 5,000 rows.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { isOwner } from '@/lib/auth';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import {
  actionItemsQuery,
  parseActionFilter,
  shapeActionItems,
  type ActionItemsRow,
} from '@/lib/reporting/actionItems';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const parsed = parseActionFilter(req.query);
  if ('error' in parsed) return apiResponse.badRequest(res, parsed.error);

  // Action items are meeting content, and FibreFlow gates meetings on ATTENDANCE, not on
  // a module permission. `dashboard.action-items` decides whether you may use this report
  // at all; the participant predicate decides WHICH meetings it covers. Both are needed:
  // the permission alone would hand every viewer 5,049 items across 1,015 meetings.
  const user = (req as AuthenticatedNextApiRequest).user;
  const email = (user.email ?? '').trim().toLowerCase();
  const owner = isOwner(user);
  if (!owner && !email) {
    return apiResponse.forbidden(res, 'An email address is required to scope meeting access.');
  }

  try {
    const { sql, params } = actionItemsQuery(parsed.filter, { isOwner: owner, email });
    const result = await pool.query<ActionItemsRow>(sql, params as unknown[]);

    // An aggregate without GROUP BY always yields one row, but the type system cannot
    // know it, and a silent undefined would report an empty backlog as fact.
    const row = result.rows[0];
    if (!row) return apiResponse.internalError(res, new Error('Action item summary returned no rows'));

    res.setHeader('Cache-Control', 'private, no-store');
    return apiResponse.success(
      res,
      shapeActionItems(row, Boolean(parsed.filter.assignee), owner),
    );
  } catch (error) {
    log.error(
      'Action item report failed',
      { module: 'reporting-actions', error: (error as Error).message },
      'reporting-actions',
    );
    return apiResponse.internalError(res, new Error('Action item report failed'));
  }
}

// `dashboard.action-items` is the module's OWN key for this data — verified against
// access_permissions, which has no bare `meetings` key at all (only `people.meetings`
// and `dashboard.action-items`). Inventing a plausible-looking key is not a smaller
// mistake than the wrong one: isPermissionBlocked denies when no role row exists, so a
// non-existent key 403s every caller who is not a super-admin while being inert for the
// super-admins who bypass RBAC.
//
// `people.meetings` would be stricter than the UI already is for the same rows, so it is
// the wrong choice rather than the safe one.
export default withAuth(withPermission('dashboard.action-items', 'view')(handler));
