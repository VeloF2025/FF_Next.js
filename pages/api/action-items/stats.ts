import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { ActionItemStats } from '@/types/action-items.types';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

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
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int as in_progress,
        COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status != 'completed')::int as overdue
      FROM meeting_action_items
    `;

    return apiResponse.success(res, stats as ActionItemStats);
  } catch (error: any) {
    log.error('Error fetching action item stats', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
