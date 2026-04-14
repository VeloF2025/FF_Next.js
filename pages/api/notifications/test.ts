/**
 * POST /api/notifications/test
 * Dev-only: Send a test notification to yourself.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { notify } from '@/modules/notifications/services';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;

  // Only allow in development or for admins
  if (process.env.NODE_ENV === 'production' && authReq.user.role !== 'admin') {
    return apiResponse.forbidden(res, 'Test notifications are only available in development');
  }

  try {
    const {
      event_type = 'noc.ticket_assigned',
      title = 'Test Notification',
      body = 'This is a test notification from the UNS.',
      severity = 'info',
    } = req.body || {};

    await notify({
      event_type,
      title,
      body,
      severity,
      action_url: '/app/dashboard',
      source_module: 'test',
      recipient_user_ids: [authReq.user.id],
    });

    return apiResponse.success(res, { sent: true, to: authReq.user.id });
  } catch (error) {
    log.error('Internal error', { error: { error } }, 'TestApi');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
