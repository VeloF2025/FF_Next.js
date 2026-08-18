import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { checkMancoAccess } from '@/lib/actionItems/mancoAccess';
import { MancoActionItemStats } from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The fifth route in this group, and the only one that was not gated. Its four
  // siblings all check here; this one counted every row in manco_action_items for any
  // authenticated caller, including the role that `dashboard.action-items` denies.
  // Counts are a small payload, but they still answer "how much is outstanding" for a
  // board that the caller is not entitled to read.
  const access = await checkMancoAccess((req as AuthenticatedNextApiRequest).user.id, req.method);
  if (!access.ok) {
    return access.status === 403
      ? apiResponse.forbidden(res, access.message)
      : apiResponse.internalError(res, new Error(access.message));
  }

  try {
    const [stats] = await sql`
      SELECT
        -- Non-ongoing items (matches ALL/PENDING/etc tabs which exclude ongoing)
        COUNT(*) FILTER (WHERE NOT is_ongoing)::int                           AS total,
        COUNT(*) FILTER (WHERE status = 'pending' AND NOT is_ongoing)::int    AS pending,
        COUNT(*) FILTER (WHERE status = 'in_progress' AND NOT is_ongoing)::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'completed' AND NOT is_ongoing)::int  AS completed,
        COUNT(*) FILTER (
          WHERE status NOT IN ('completed', 'cancelled')
            AND NOT is_ongoing
            AND completion_eta < CURRENT_DATE
        )::int                                                                 AS overdue,
        -- Ongoing items (matches ONGOING tab)
        COUNT(*) FILTER (WHERE is_ongoing)::int                               AS ongoing
      FROM manco_action_items
    `;

    return apiResponse.success(res, stats as unknown as MancoActionItemStats);
  } catch (error: unknown) {
    log.error('Error fetching manco action items stats', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
