import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { checkMancoAccess } from '@/lib/actionItems/mancoAccess';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Same gate as the rest of the group. This returns meeting titles and dates for any
  // item id, so an ungated caller could confirm which meetings exist and when — the
  // property meeting-context deliberately withholds by answering with an empty shape.
  const access = await checkMancoAccess((req as AuthenticatedNextApiRequest).user.id, req.method);
  if (!access.ok) {
    return access.status === 403
      ? apiResponse.forbidden(res, access.message)
      : apiResponse.internalError(res, new Error(access.message));
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
