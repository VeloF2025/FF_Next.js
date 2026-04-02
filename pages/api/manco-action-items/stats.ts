import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
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
