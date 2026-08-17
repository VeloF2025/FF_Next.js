import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { resolveActionItemAccess } from '@/lib/actionItems/meetingAccess';
import { commentVisibility } from '@/lib/actionItems/commentAccess';
import pool from '@/lib/db';
import { MancoActionItemComment } from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const resolved = resolveActionItemAccess((req as AuthenticatedNextApiRequest).user);
  if ('error' in resolved) return apiResponse.forbidden(res, resolved.error);

  if (req.method === 'GET') {
    try {
      const { item_id } = req.query;

      if (!item_id || typeof item_id !== 'string') {
        return apiResponse.badRequest(res, 'item_id is required');
      }

      // A comment is either something a person wrote — visible to anyone who can see
      // the item — or verbatim transcript extracted from a meeting, which carries the
      // meeting's own attendance gate. Serving them together with `SELECT *` made this
      // route the sink that undid the gate on the extractor: the excerpts outlive the
      // request that pulled them, and this is where they were read from.
      //
      // source_meeting_id is the structural distinction (migration 493). The old
      // `[From meeting: <title>]` prefix inside the free text is not one: it is
      // forgeable by anyone who can post a comment, and it depends on a title that can
      // change.
      const params: unknown[] = [item_id];
      const visible = commentVisibility(resolved.access, params);
      const comments = (
        await pool.query(
          `SELECT * FROM manco_action_item_comments c
            WHERE c.manco_action_item_id = $1::uuid
              AND ${visible}
            ORDER BY c.created_at DESC`,
          params,
        )
      ).rows;

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
