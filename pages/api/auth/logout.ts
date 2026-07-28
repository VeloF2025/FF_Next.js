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
    // Tracks whether the sweep actually ran, so the response cannot claim "all devices"
    // when the gate below withheld it.
    let sweptAllDevices = false;

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
          // The account-wide sweep needs a session we could positively identify as not
          // being an MCP one. `getSession` returns null both when the row is gone and
          // when it has expired, while the JWT stays cryptographically valid until its
          // own exp — which is exactly the state a REVOKED MCP token sits in. The JWT
          // does not carry `kind`, so a null lookup means "unidentifiable credential",
          // and `session?.kind === 'mcp'` above cannot catch it. Sweeping every session
          // on the account off an unidentifiable credential is precisely the destructive
          // act this gate exists to prevent, so fail closed and skip it.
          //
          // Only the sweep is withheld: the cookie is still cleared below, so this keeps
          // the stale-cookie relief that is the reason this route avoids withAuth.
          if (session) {
            // "All devices" includes MCP connectors. It must not leave a read credential
            // alive that outlives the sweep — hence the kind-agnostic sweep, not the
            // browser-only `deleteAllUserSessions`.
            await deleteEveryUserSession(payload.sub);
            sweptAllDevices = true;
          } else {
            log.warn('Refused all-devices logout for an unresolvable session', {
              userId: payload.sub,
            });
          }
        } else {
          // Delete just this session. Safe to leave permissive when the row is already
          // gone: it is a no-op on a missing id, and it is not account-wide. Routine
          // sign-out takes this branch and leaves connectors running.
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
      data: {
        message: sweptAllDevices ? 'Logged out from all devices' : 'Logged out successfully',
      },
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
