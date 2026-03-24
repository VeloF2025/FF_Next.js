/**
 * Badge Counts API
 * GET /api/communications/badge-counts
 *
 * Returns unread/pending counts for inbox, notifications, and action items.
 * Used by useBadgeCounts hook to drive nav badge indicators.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const authUser = (req as AuthenticatedNextApiRequest).user;
  const userId = authUser.id;
  const userEmail = authUser.email;

  try {
    // Single CTE query — three counts in one round trip
    const result = await sql`
      WITH inbox_count AS (
        SELECT COUNT(*)::int AS cnt
        FROM internal_message_recipients r
        INNER JOIN internal_messages m ON m.id = r.message_id
        WHERE r.recipient_id = ${userId}::uuid
          AND r.is_read = FALSE
          AND r.is_archived = FALSE
          AND m.thread_id IS NULL
      ),
      notification_count AS (
        SELECT COUNT(*)::int AS cnt
        FROM user_notifications n
        WHERE n.user_id = ${userId}::uuid
          AND n.is_read = FALSE
      ),
      action_item_count AS (
        SELECT COUNT(*)::int AS cnt
        FROM action_items ai
        WHERE (ai.assignee_email = ${userEmail} OR ai.created_by = ${userId}::uuid OR ai.assigned_to_user_id = ${userId}::uuid)
          AND ai.status::text = 'pending'
      )
      SELECT
        (SELECT cnt FROM inbox_count)        AS inbox,
        (SELECT cnt FROM notification_count) AS notifications,
        (SELECT cnt FROM action_item_count)  AS action_items
    `;

    const row = result[0] ?? { inbox: 0, notifications: 0, action_items: 0 };

    return apiResponse.success(res, {
      inbox: Number(row.inbox ?? 0),
      notifications: Number(row.notifications ?? 0),
      actionItems: Number(row.action_items ?? 0),
    });
  } catch (error) {
    log.error('Failed to fetch badge counts', { error }, 'BadgeCounts');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
