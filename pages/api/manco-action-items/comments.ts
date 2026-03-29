import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { MancoActionItemComment } from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    try {
      const { item_id } = req.query;

      if (!item_id || typeof item_id !== 'string') {
        return apiResponse.badRequest(res, 'item_id is required');
      }

      const comments = await sql`
        SELECT * FROM manco_action_item_comments
        WHERE manco_action_item_id = ${item_id}::uuid
        ORDER BY created_at DESC
      `;

      return apiResponse.success(res, comments as unknown as MancoActionItemComment[]);
    } catch (error: unknown) {
      log.error('Error fetching comments', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const { manco_action_item_id, author_name, author_user_id, content } = req.body;

      if (!manco_action_item_id || !author_name || !content) {
        return apiResponse.badRequest(res, 'manco_action_item_id, author_name, and content are required');
      }

      const itemIdStr = String(manco_action_item_id);
      let comment;
      if (author_user_id) {
        const userIdStr = String(author_user_id);
        [comment] = await sql`
          INSERT INTO manco_action_item_comments (
            manco_action_item_id, author_name, author_user_id, content
          ) VALUES (
            ${itemIdStr}::uuid, ${author_name}, ${userIdStr}::uuid, ${content}
          )
          RETURNING *
        `;
      } else {
        [comment] = await sql`
          INSERT INTO manco_action_item_comments (
            manco_action_item_id, author_name, content
          ) VALUES (
            ${itemIdStr}::uuid, ${author_name}, ${content}
          )
          RETURNING *
        `;
      }

      res.status(201);
      return apiResponse.success(res, comment as unknown as MancoActionItemComment);
    } catch (error: unknown) {
      log.error('Error creating comment', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
