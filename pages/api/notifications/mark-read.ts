/**
 * POST /api/notifications/mark-read
 * Mark specific notifications as read.
 * Body: { notification_ids: string[] }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { markAsRead } from '@/modules/notifications/services';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;

  try {
    const { notification_ids } = req.body || {};

    if (!Array.isArray(notification_ids) || notification_ids.length === 0) {
      return apiResponse.badRequest(res, 'notification_ids must be a non-empty array');
    }

    const updated = await markAsRead(notification_ids, authReq.user.id);
    return apiResponse.success(res, { updated });
  } catch (error) {
    log.error('MarkReadApi', 'Internal error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
