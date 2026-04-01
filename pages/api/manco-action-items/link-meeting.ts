import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    try {
      const { manco_action_item_id, meeting_id } = req.body;

      if (!manco_action_item_id || !meeting_id) {
        return apiResponse.badRequest(res, 'manco_action_item_id and meeting_id are required');
      }

      const meetingIdNum = Number(meeting_id);
      if (!Number.isFinite(meetingIdNum) || meetingIdNum <= 0) {
        return apiResponse.badRequest(res, 'meeting_id must be a positive number');
      }

      const meeting = await sql`SELECT id, title FROM meetings WHERE id = ${meetingIdNum}`;
      if (meeting.length === 0) {
        return apiResponse.notFound(res, 'Meeting', meeting_id);
      }

      const result = await sql`
        INSERT INTO manco_action_item_meetings (manco_action_item_id, meeting_id)
        VALUES (${String(manco_action_item_id)}::uuid, ${meetingIdNum})
        ON CONFLICT (manco_action_item_id, meeting_id) DO NOTHING
        RETURNING id
      `;

      const existingLinks = await sql`
        SELECT COUNT(*)::int as cnt FROM manco_action_item_meetings
        WHERE manco_action_item_id = ${String(manco_action_item_id)}::uuid
      `;
      if (Number(existingLinks[0].cnt) === 1) {
        await sql`
          UPDATE manco_action_items SET source_meeting_id = ${meetingIdNum}, updated_at = NOW()
          WHERE id = ${String(manco_action_item_id)}::uuid
        `;
      }

      log.info('Meeting linked to manco item', { itemId: manco_action_item_id, meetingId: meetingIdNum, meetingTitle: meeting[0].title });
      return apiResponse.success(res, { linked: result.length > 0, meeting_title: meeting[0].title });
    } catch (error: unknown) {
      log.error('Error linking meeting', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { manco_action_item_id, meeting_id } = req.body;
      if (!manco_action_item_id || !meeting_id) {
        return apiResponse.badRequest(res, 'manco_action_item_id and meeting_id are required');
      }

      await sql`
        DELETE FROM manco_action_item_meetings
        WHERE manco_action_item_id = ${String(manco_action_item_id)}::uuid AND meeting_id = ${Number(meeting_id)}
      `;

      log.info('Meeting unlinked', { itemId: manco_action_item_id, meetingId: meeting_id });
      return apiResponse.success(res, { unlinked: true });
    } catch (error: unknown) {
      log.error('Error unlinking meeting', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
