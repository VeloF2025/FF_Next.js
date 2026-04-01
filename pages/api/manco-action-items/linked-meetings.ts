import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { item_id } = req.query;
    if (!item_id || typeof item_id !== 'string') {
      return apiResponse.badRequest(res, 'item_id is required');
    }

    const rows = await sql`
      SELECT
        mam.id,
        mam.meeting_id,
        m.title as meeting_title,
        m.meeting_date
      FROM manco_action_item_meetings mam
      JOIN meetings m ON m.id = mam.meeting_id
      WHERE mam.manco_action_item_id = ${item_id}::uuid
      ORDER BY m.meeting_date DESC
    `;

    return apiResponse.success(res, rows);
  } catch (error: unknown) {
    log.error('Error fetching linked meetings', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
