/**
 * Mark Messages as Read
 * PUT /api/communications/messages-read
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PUT']);
  }

  const userId = (req as AuthenticatedNextApiRequest).user.id;

  try {
    const { messageIds } = req.body;

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return apiResponse.badRequest(res, 'messageIds array is required');
    }

    const result = await sql`
      UPDATE internal_message_recipients
      SET is_read = TRUE, read_at = NOW()
      WHERE recipient_id = ${userId}::uuid
        AND message_id = ANY(${messageIds}::uuid[])
        AND is_read = FALSE
    `;

    log.info('Messages marked as read', {
      userId,
      count: messageIds.length,
    }, 'Messages');

    return apiResponse.success(res, { updated: messageIds.length });
  } catch (error) {
    log.error('Failed to mark messages as read', { error }, 'Messages');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
