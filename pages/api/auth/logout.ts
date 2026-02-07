/**
 * Logout API
 * POST /api/auth/logout
 * Clears auth cookie and deletes session
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import {
  verifyToken,
  deleteSession,
  deleteAllUserSessions,
  AUTH_COOKIE_NAME,
} from '@/lib/auth';
import { log } from '@/lib/logger';

interface LogoutRequestBody {
  allDevices?: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' },
    });
  }

  try {
    const { allDevices = false } = (req.body || {}) as LogoutRequestBody;

    // Get token from cookie
    const token = req.cookies[AUTH_COOKIE_NAME];

    if (token) {
      // Verify and get session info
      const payload = await verifyToken(token);

      if (payload) {
        if (allDevices) {
          // Delete all sessions for this user
          await deleteAllUserSessions(payload.sub);
        } else {
          // Delete just this session
          await deleteSession(payload.sessionId);
        }
      }
    }

    // Clear the cookie regardless
    const cookie = serialize(AUTH_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0, // Expire immediately
      path: '/',
    });

    res.setHeader('Set-Cookie', cookie);

    return res.status(200).json({
      success: true,
      data: { message: allDevices ? 'Logged out from all devices' : 'Logged out successfully' },
    });
  } catch (error) {
    log.error('Logout error', { error });

    // Still clear the cookie even on error
    const cookie = serialize(AUTH_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    res.setHeader('Set-Cookie', cookie);

    return res.status(200).json({
      success: true,
      data: { message: 'Logged out' },
    });
  }
}
