/**
 * Auth utilities for Next.js App Router routes (NextRequest).
 * Provides the same JWT-based identity resolution as withAuth() in middleware.ts,
 * but compatible with the App Router request/response API.
 *
 * Usage:
 *   import { getUserFromRequest } from '@/lib/auth/app-router';
 *   const user = await getUserFromRequest(req);
 *   if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   const userId = user.id;
 */

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './jwt';
import { AUTH_COOKIE_NAME } from './middleware';
import { isReadOnlyViolation, MCP_READ_ONLY_CODE, MCP_READ_ONLY_MESSAGE } from './readOnly';
import { touchSessionUsage } from './sessionUsage';
import type { AuthUser, SessionKind } from './types';
import { pool } from '@/lib/db';
import { userHasPermission, type PermissionAction } from '@/lib/permissions';

/**
 * Extract the JWT token from a NextRequest (cookie or Authorization header).
 */
function extractToken(req: NextRequest): string | null {
  // 1. Cookie (preferred)
  const cookieToken = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;

  // 2. Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * Resolve the full AuthUser from a NextRequest.
 * Returns null if the request is unauthenticated or the token is invalid.
 *
 * IMPORTANT: User identity comes ONLY from the verified JWT — never from
 * client-supplied headers like x-user-id.
 */
export async function getUserFromRequest(req: NextRequest): Promise<AuthUser | null> {
  const token = extractToken(req);
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || !payload.sub) return null;

  // The Pages Router path (middleware.ts) has always required the presented token to
  // match the session's stored hash. Match it here so one credential cannot have two
  // different security postures depending on which router serves the route.
  const tokenHash = createHash('sha256').update(token).digest('hex');

  try {
    const result = await pool.query<AuthUser & { kind: string }>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.permissions,
              u.is_active, u.profile_picture, u.department, s.kind
       FROM users u
       INNER JOIN user_sessions s ON s.user_id = u.id
       WHERE u.id = $1
         AND s.id = $2
         AND s.token_hash = $3
         AND u.is_active = true
         AND s.expires_at > NOW()
       LIMIT 1`,
      [payload.sub, payload.sessionId, tokenHash]
    );

    const row = result.rows[0];
    if (!row) return null;
    const sessionKind = (row.kind ?? 'browser') as SessionKind;
    touchSessionUsage(payload.sessionId, sessionKind);
    return { ...row, sessionKind };
  } catch {
    return null;
  }
}

/**
 * Convenience: require authentication or return a 401 response.
 * Returns [user, null] on success, [null, 401Response] on failure.
 *
 * Usage:
 *   const [user, unauth] = await requireAuth(req);
 *   if (unauth) return unauth;
 */
export async function requireAuth(
  req: NextRequest
): Promise<[AuthUser, null] | [null, NextResponse]> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return [null, NextResponse.json({ error: 'Unauthorized' }, { status: 401 })];
  }
  if (isReadOnlyViolation(user, req.method)) {
    return [
      null,
      NextResponse.json(
        { success: false, error: { code: MCP_READ_ONLY_CODE, message: MCP_READ_ONLY_MESSAGE } },
        { status: 403 }
      ),
    ];
  }
  return [user, null];
}

/**
 * Convenience: require authentication AND an RBAC permission, or return a
 * 401/403 response. Composes requireAuth() with userHasPermission() (which
 * bypasses for super_admin and applies the parent-cascade rule).
 *
 * Returns [user, null] when allowed, [null, response] when denied — same
 * tuple shape as requireAuth so callers stay uniform:
 *   const [user, deny] = await requirePermission(req, 'assets', 'delete');
 *   if (deny) return deny;
 */
export async function requirePermission(
  req: NextRequest,
  permissionKey: string,
  action: PermissionAction
): Promise<[AuthUser, null] | [null, NextResponse]> {
  const [user, unauth] = await requireAuth(req);
  if (unauth) return [null, unauth];
  if (!(await userHasPermission(user.id, permissionKey, action))) {
    return [null, NextResponse.json({ error: 'Forbidden' }, { status: 403 })];
  }
  return [user, null];
}
