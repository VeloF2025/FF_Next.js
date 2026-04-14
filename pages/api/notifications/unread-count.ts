/**
 * GET /api/notifications/unread-count
 * Returns the unread notification count for the bell badge.
 * Polled every 30s by the frontend.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { getUnreadCount } from '@/modules/notifications/services';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const authReq = req as AuthenticatedNextApiRequest;

  try {
    const count = await getUnreadCount(authReq.user.id);
    return apiResponse.success(res, count);
  } catch (error) {
    log.error('Internal error', { error: { error } }, 'UnreadCountApi');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
