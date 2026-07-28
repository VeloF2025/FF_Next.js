/**
 * Logout API
 * POST /api/auth/logout
 * Clears auth cookie and deletes session
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import {
  verifyToken,
  getSession,
  deleteSession,
  deleteEveryUserSession,
  AUTH_COOKIE_NAME,
} from '@/lib/auth';
import { MCP_READ_ONLY_CODE, MCP_READ_ONLY_MESSAGE } from '@/lib/auth/readOnly';
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
        // This route resolves the user itself rather than going through withAuth, so it
        // does not inherit the read-only gate — check explicitly. Without this an MCP
        // token can POST here and, with allDevices, terminate every session on the
        // account including the owner's live browser session. Destructive, and precisely
        // what a read-only credential must not be able to do.
        //
        // NOT done by wrapping the handler in withAuth: this route deliberately clears
        // the cookie even for an invalid or expired token, and withAuth would 401 those
        // callers, leaving a stale cookie nobody can shed.
        const session = await getSession(payload.sessionId);
        if (session?.kind === 'mcp') {
          log.warn('Refused logout from a read-only MCP session', { userId: payload.sub });
          return res.status(403).json({
            success: false,
            error: { code: MCP_READ_ONLY_CODE, message: MCP_READ_ONLY_MESSAGE },
          });
        }

        if (allDevices) {
          // "All devices" includes MCP connectors. This is the flow a user reaches for
          // when they suspect compromise, so it must not leave a read credential alive
          // that outlives the sweep — hence the kind-agnostic sweep, not the
          // browser-only `deleteAllUserSessions`. Routine sign-out takes the branch
          // below, which drops only the current session and leaves connectors running.
          await deleteEveryUserSession(payload.sub);
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
