import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { ActionItemStats } from '@/types/action-items.types';
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
        COUNT(*)::int                                                          AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int                       AS pending,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int                   AS in_progress,
        COUNT(*) FILTER (WHERE status = 'completed')::int                     AS completed,
        COUNT(*) FILTER (
          WHERE due_date < NOW() AND status != 'completed'
        )::int                                                                 AS overdue,
        COUNT(*) FILTER (WHERE source_type = 'meeting')::int                  AS from_meetings,
        COUNT(*) FILTER (WHERE source_type = 'procurement')::int              AS from_procurement,
        COUNT(*) FILTER (WHERE source_type = 'noc')::int                      AS from_noc,
        COUNT(*) FILTER (WHERE assigned_to_user_id IS NOT NULL)::int          AS user_linked
      FROM action_items
    `;

    return apiResponse.success(res, stats as unknown as ActionItemStats);
  } catch (error: unknown) {
    log.error('Error fetching action item stats', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
