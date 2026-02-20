/**
 * GET /api/notifications
 * List notifications for the authenticated user.
 * Query params: limit (default 20), offset (default 0), unread_only (boolean)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { getNotifications } from '@/modules/notifications/services';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const authReq = req as AuthenticatedNextApiRequest;

  try {
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
    const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
    const unreadOnly = req.query.unread_only === 'true';

    const notifications = await getNotifications(authReq.user.id, limit, offset, unreadOnly);
    return apiResponse.success(res, notifications);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
