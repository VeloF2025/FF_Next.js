/**
 * Fleet Portal - Logout API
 * POST: Clear portal session cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import { apiResponse } from '@/lib/apiResponse';
import {
  PORTAL_SESSION_COOKIE,
  getPortalSessionFromCookie,
} from '@/modules/fleet/portal/portalSessionUtils';
import { log } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['POST']);
  }

  try {
    // Get session for logging
    const session = getPortalSessionFromCookie(req);

    if (session) {
      log.info('[portal-logout] Session ended', {
        sessionId: session.sessionId,
        vehicleId: session.vehicleId,
        vehicleRegistration: session.vehicleRegistration,
      });
    }

    // Clear the session cookie by setting it to empty with immediate expiry
    res.setHeader(
      'Set-Cookie',
      serialize(PORTAL_SESSION_COOKIE, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0, // Immediate expiry
      })
    );

    return apiResponse.success(res, { loggedOut: true });
  } catch (error) {
    log.error('LogoutApi', 'Internal error', { error });
    return apiResponse.internalError(res, error);
  }
}
