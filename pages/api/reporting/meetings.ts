/**
 * GET /api/reporting/meetings?search=…&since=YYYY-MM-DD&until=YYYY-MM-DD&withTranscript=true
 *
 * Meeting search for reporting, scoped to the meetings the caller attended. Returns a
 * compact index — title, date, participant count, whether a transcript or summary exists,
 * how many action items came out of it — not the meeting contents.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { resolveActionItemAccess } from '@/lib/actionItems/meetingAccess';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import {
  meetingsQuery,
  parseMeetingFilter,
  shapeMeetings,
  type MeetingRow,
} from '@/lib/reporting/meetings';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const parsed = parseMeetingFilter(req.query);
  if ('error' in parsed) return apiResponse.badRequest(res, parsed.error);

  // Meetings are gated on ATTENDANCE, not on a module permission. `people.meetings`
  // decides whether you may use this search at all; the participant predicate decides
  // which meetings it covers.
  const resolved = resolveActionItemAccess((req as AuthenticatedNextApiRequest).user);
  if ('error' in resolved) return apiResponse.forbidden(res, resolved.error);

  try {
    const { sql, params } = meetingsQuery(parsed.filter, resolved.access);
    const result = await pool.query<MeetingRow & { total_matched: number }>(sql, params);

    res.setHeader('Cache-Control', 'private, no-store');
    return apiResponse.success(
      res,
      shapeMeetings(result.rows, parsed.filter, resolved.access.isOwner),
    );
  } catch (error) {
    log.error(
      'Meeting search failed',
      { module: 'reporting-meetings', error: (error as Error).message },
      'reporting-meetings',
    );
    return apiResponse.internalError(res, new Error('Meeting search failed'));
  }
}

// `people.meetings` — queried against access_permissions, which holds exactly one
// meeting-related key and no bare `meetings`. Inventing a plausible-looking key is not a
// smaller mistake than choosing the wrong one: isPermissionBlocked denies when no role row
// exists, so a non-existent key 403s every caller who is not a super-admin while being
// inert for the super-admins who bypass RBAC.
//
// Who this admits, measured: manager (15 active), super_admin (10), admin (6) — 31 of 85.
// contractor and storeman are explicitly denied; viewer (43) and technician (11) hold no
// row at all and are therefore denied too. That is narrower than /api/meetings, which is
// withAuth plus attendance and so admits anyone who attended. Narrower is the right
// default for a tool whose output goes to an agent, and managers are its audience — but it
// does mean a viewer who sat in a meeting cannot search for it here.
export default withAuth(withPermission('people.meetings', 'view')(handler));
