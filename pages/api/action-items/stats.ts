import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import {
  actionItemVisibility,
  resolveActionItemAccess,
} from '@/lib/actionItems/meetingAccess';
import pool from '@/lib/db';
import { ActionItemStats } from '@/types/action-items.types';
import { log } from '@/lib/logger';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  // Counts are derived from the same rows the list returns, so they carry the same gate.
  // An ungated total is not a smaller leak than an ungated list: it reports how many
  // meetings-worth of work exist that the caller was not part of, and the dashboard
  // headline would disagree with the list beneath it.
  const resolved = resolveActionItemAccess((req as AuthenticatedNextApiRequest).user);
  if ('error' in resolved) return apiResponse.forbidden(res, resolved.error);

  try {
    const params: unknown[] = [];
    const visibility = actionItemVisibility(resolved.access, params);

    const result = await pool.query(
      `SELECT
        COUNT(*)::int                                                 AS total,
        COUNT(*) FILTER (WHERE ai.status::text = 'pending')::int      AS pending,
        COUNT(*) FILTER (WHERE ai.status::text = 'in_progress')::int  AS in_progress,
        COUNT(*) FILTER (WHERE ai.status::text = 'completed')::int    AS completed,
        COUNT(*) FILTER (
          WHERE ai.due_date < NOW() AND ai.status::text <> 'completed'
        )::int                                                        AS overdue,
        COUNT(*) FILTER (WHERE ai.source_type = 'meeting')::int       AS from_meetings,
        COUNT(*) FILTER (WHERE ai.source_type = 'procurement')::int   AS from_procurement,
        COUNT(*) FILTER (WHERE ai.source_type = 'noc')::int           AS from_noc,
        COUNT(*) FILTER (WHERE ai.assigned_to_user_id IS NOT NULL)::int AS user_linked
      FROM action_items ai
      WHERE ${visibility}`,
      params,
    );

    // A bare aggregate always yields one row, but the type system cannot know it and a
    // silent undefined would render an empty dashboard as a factual zero.
    const stats = result.rows[0];
    if (!stats) {
      return apiResponse.internalError(res, new Error('Action item stats returned no rows'));
    }

    return apiResponse.success(res, stats as unknown as ActionItemStats);
  } catch (error: unknown) {
    log.error('Error fetching action item stats', {
      module: 'action-items',
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
