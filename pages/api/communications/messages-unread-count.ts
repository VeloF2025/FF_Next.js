/**
 * Unread Message Count
 * GET /api/communications/messages-unread-count
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

  try {
    const result = await sql`
      SELECT COUNT(*)::int AS count
      FROM internal_message_recipients r
      INNER JOIN internal_messages m ON m.id = r.message_id
      WHERE r.recipient_id = ${userId}::uuid
        AND r.is_read = FALSE
        AND r.is_archived = FALSE
        AND m.thread_id IS NULL
    `;

    return apiResponse.success(res, { count: Number(result[0]?.count || 0) });
  } catch (error) {
    log.error('Failed to get unread count', { error }, 'Messages');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
