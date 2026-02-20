/**
 * POST /api/notifications/mark-all-read
 * Mark all notifications as read for the authenticated user.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { markAllAsRead } from '@/modules/notifications/services';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;

  try {
    const updated = await markAllAsRead(authReq.user.id);
    return apiResponse.success(res, { updated });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
