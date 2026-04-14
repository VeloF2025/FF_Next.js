/**
 * Message Thread API
 * GET /api/communications/messages-thread?threadId=<root-message-id>
 * Returns root message + all replies, marks as read for current user
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

  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const threadId = req.query.threadId as string;

  if (!threadId) {
    return apiResponse.badRequest(res, 'threadId is required');
  }

  try {
    // Fetch the root message
    const rootRows = await sql`
      SELECT
        m.id, m.sender_id, m.subject, m.body, m.priority,
        m.context_module, m.context_id, m.context_url, m.created_at,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) AS sender_name,
        u.email AS sender_email
      FROM internal_messages m
      INNER JOIN users u ON u.id = m.sender_id
      WHERE m.id = ${threadId}::uuid
    `;

    if (rootRows.length === 0) {
      return apiResponse.notFound(res, 'Message', threadId);
    }

    // Fetch replies
    const replies = await sql`
      SELECT
        m.id, m.sender_id, m.body, m.created_at,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) AS sender_name,
        u.email AS sender_email
      FROM internal_messages m
      INNER JOIN users u ON u.id = m.sender_id
      WHERE m.thread_id = ${threadId}::uuid
      ORDER BY m.created_at ASC
    `;

    // Fetch recipients of root message
    const recipients = await sql`
      SELECT
        r.recipient_id AS id,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) AS name,
        u.email,
        r.is_read
      FROM internal_message_recipients r
      INNER JOIN users u ON u.id = r.recipient_id
      WHERE r.message_id = ${threadId}::uuid
    `;

    // Auto-mark all thread messages as read for this user
    const allMessageIds = [threadId, ...replies.map((r: Record<string, any>) => r.id as string)];
    await sql`
      UPDATE internal_message_recipients
      SET is_read = TRUE, read_at = NOW()
      WHERE recipient_id = ${userId}::uuid
        AND message_id = ANY(${allMessageIds}::uuid[])
        AND is_read = FALSE
    `;

    return apiResponse.success(res, {
      root: rootRows[0],
      replies,
      recipients,
    });
  } catch (error) {
    log.error('Failed to fetch thread', { error, threadId }, 'Messages');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
