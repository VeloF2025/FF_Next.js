/**
 * Impersonation API
 * POST /api/admin/impersonate
 * Allows authorized admins to impersonate another user by creating a short-lived session.
 * Caller must have 'can_impersonate' in their permissions array.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import {
  withAuth,
  hasPermission,
  signToken,
  createImpersonationSession,
  type AuthenticatedNextApiRequest,
  type AuthRole,
  type AuthUser,
} from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface ImpersonateRequestBody {
  targetUserId: string;
}

/** Shape of the target user row returned from the DB */
interface TargetUserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  permissions: string[];
  is_active: boolean;
  profile_picture: string | null;
  department: string | null;
}

async function handler(
  rawReq: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  // withAuth guarantees req.user and req.sessionId are populated
  const req = rawReq as AuthenticatedNextApiRequest;

  // 1. Method guard
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }

  // 2. Permission guard — caller must hold can_impersonate
  if (!hasPermission(req.user, 'can_impersonate')) {
    apiResponse.forbidden(res, 'Missing required permission: can_impersonate');
    return;
  }

  // 3. Input validation
  const { targetUserId } = (req.body ?? {}) as ImpersonateRequestBody;
  if (!targetUserId || typeof targetUserId !== 'string') {
    apiResponse.badRequest(res, 'targetUserId is required and must be a string');
    return;
  }

  // 4. Cannot impersonate yourself
  if (targetUserId === req.user.id) {
    apiResponse.badRequest(res, 'You cannot impersonate yourself');
    return;
  }

  const ipAddress =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    undefined;
  const userAgent = req.headers['user-agent'] ?? undefined;

  try {
    // 5. Target user must exist and be active
    const userResult = await sql`
      SELECT
        id, email, first_name, last_name, role, permissions,
        is_active, profile_picture, department
      FROM users
      WHERE id = ${targetUserId}
    `;

    if (userResult.length === 0) {
      apiResponse.notFound(res, 'User', targetUserId);
      return;
    }

    const row = userResult[0] as TargetUserRow;

    if (!row.is_active) {
      apiResponse.notFound(res, 'User', targetUserId);
      return;
    }

    // 6. Cannot impersonate a super_admin
    if (row.role === 'super_admin') {
      apiResponse.badRequest(res, 'Cannot impersonate a super admin');
      return;
    }

    // Build AuthUser from DB row (needed for signToken)
    const firstName = row.first_name ?? '';
    const lastName = row.last_name ?? '';
    const targetUser: AuthUser = {
      id: row.id,
      userId: row.id,
      email: row.email,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim() || row.email,
      role: row.role as AuthRole,
      permissions: (row.permissions as string[]) || [],
      isActive: row.is_active,
      profilePicture: row.profile_picture ?? undefined,
      department: row.department ?? undefined,
    };

    // Step 1: Create session with empty token hash (mirrors login.ts pattern)
    const session = await createImpersonationSession(
      targetUser.id,
      '',
      req.user.id,
      ipAddress,
      userAgent
    );

    // Step 2: Sign JWT with session ID and impersonation claims
    const token = await signToken(targetUser, session.id, '1h', {
      isImpersonation: true,
      impersonatedBy: req.user.id,
    });

    // Step 3: Update session with the real token hash
    await sql`
      UPDATE user_sessions
      SET token_hash = encode(sha256(${token}::bytea), 'hex')
      WHERE id = ${session.id}
    `;

    // Audit log — same pattern as admin/users/[userId].ts
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'impersonation_started',
        'user',
        ${targetUser.id},
        ${JSON.stringify({ targetEmail: targetUser.email, targetRole: targetUser.role })}::jsonb,
        ${ipAddress ?? null}
      )
    `;

    log.info(
      'Impersonation session created',
      { by: req.user.email, target: targetUser.email, sessionId: session.id },
      'Impersonation'
    );

    apiResponse.success(res, {
      url: `/auth/impersonate?token=${encodeURIComponent(token)}`,
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
      },
    });
  } catch (error) {
    log.error(
      'Error creating impersonation session',
      error instanceof Error ? { message: error.message, stack: error.stack } : { error },
      'Impersonation'
    );
    apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
