/**
 * Batch User Permissions API
 * PUT /api/admin/users/[userId]/permissions-batch
 * Accepts desired effective state for all permissions,
 * computes overrides by diffing against role defaults
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { batchSetUserPermissions } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';
import log from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface DesiredPermission {
  key: string;
  actions: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
  };
}

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'PUT') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return apiResponse.badRequest(res, 'User ID is required');
  }

  // Verify user exists
  const userResult = await sql`
    SELECT id, email, role FROM users WHERE id = ${userId}
  `;
  if (userResult.length === 0) {
    return apiResponse.notFound(res, 'User', userId);
  }

  try {
    const { desiredPermissions } = req.body as { desiredPermissions: DesiredPermission[] };

    if (!Array.isArray(desiredPermissions)) {
      return apiResponse.badRequest(res, 'desiredPermissions must be an array of { key, actions }');
    }

    // Batch set permissions
    const result = await batchSetUserPermissions(
      userId,
      desiredPermissions,
      req.user.id
    );

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'user_permissions_batch_update',
        'user_permission',
        ${userId},
        ${JSON.stringify({
          targetUser: userResult[0].email,
          targetRole: userResult[0].role,
          overridesCreated: result.overridesCreated,
          overridesRemoved: result.overridesRemoved,
          totalPermissions: desiredPermissions.length,
          changedBy: req.user.email,
        })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    log.info(
      { userId, overridesCreated: result.overridesCreated },
      'User permissions batch updated'
    );

    return apiResponse.success(res, {
      message: 'User permissions updated',
      overridesCreated: result.overridesCreated,
      overridesRemoved: result.overridesRemoved,
    });
  } catch (error) {
    log.error({ error, userId }, 'Error batch updating user permissions');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
