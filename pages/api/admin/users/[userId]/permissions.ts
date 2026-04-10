/**
 * User Permissions API
 * GET /api/admin/users/[userId]/permissions - Get user's effective permissions + overrides
 * POST /api/admin/users/[userId]/permissions - Grant/revoke permission override
 * DELETE /api/admin/users/[userId]/permissions - Remove permission override
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import {
  getUserEffectivePermissions,
  getUserPermissionOverrides,
  getRolePermissions,
  grantUserPermission,
  revokeUserPermission,
  removeUserPermissionOverride,
  getPermissions,
} from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  const { userId } = req.query;

  if (!userId || typeof userId !== 'string') {
    return apiResponse.badRequest(res, 'User ID is required');
  }

  // Verify user exists
  const userResult = await sql`SELECT id, role, email FROM users WHERE id = ${userId}`;
  if (userResult.length === 0) {
    return apiResponse.notFound(res, 'User', userId);
  }
  const user = userResult[0]!;

  if (req.method === 'GET') {
    return handleGet(req, res, userId, user.role);
  }

  if (req.method === 'POST') {
    return handlePost(req, res, userId);
  }

  if (req.method === 'DELETE') {
    return handleDelete(req, res, userId);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
}

async function handleGet(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  userId: string,
  userRole: string
) {
  try {
    // Get all permissions for reference
    const allPermissions = await getPermissions();

    // Get role-based permissions (template)
    const rolePermissions = await getRolePermissions(userRole);

    // Get user's custom overrides
    const overrides = await getUserPermissionOverrides(userId);

    // Get effective permissions (role + overrides combined)
    const effectivePermissions = await getUserEffectivePermissions(userId);

    // Build a map of role permissions for easy lookup
    const rolePermMap = new Map(
      rolePermissions.map(rp => [rp.permissionKey, rp.actions])
    );

    // Build a map of overrides for easy lookup
    const overrideMap = new Map(
      overrides.map(o => [o.permissionKey, o])
    );

    // Build detailed permission list with source info
    const permissionsWithSource = allPermissions.map(perm => {
      const roleActions = rolePermMap.get(perm.key) || { view: false, create: false, edit: false, delete: false };
      const override = overrideMap.get(perm.key);
      const effective = effectivePermissions.find(ep => ep.permissionKey === perm.key);

      return {
        key: perm.key,
        label: perm.label,
        type: perm.type,
        parentKey: perm.parentKey,
        roleActions,
        override: override ? {
          type: override.overrideType,
          actions: override.actions,
          reason: override.reason,
          grantedAt: override.grantedAt,
          expiresAt: override.expiresAt,
        } : null,
        effectiveActions: effective ? {
          view: effective.canView,
          create: effective.canCreate,
          edit: effective.canEdit,
          delete: effective.canDelete,
        } : { view: false, create: false, edit: false, delete: false },
      };
    });

    return apiResponse.success(res, {
      userId,
      userRole,
      permissions: permissionsWithSource,
      overrideCount: overrides.length,
    });
  } catch (error) {
    log.error('Error fetching user permissions', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  userId: string
) {
  try {
    const { permissionKey, actions, overrideType, reason, expiresAt } = req.body;

    if (!permissionKey) {
      return apiResponse.badRequest(res, 'Permission key is required');
    }

    if (!overrideType || !['grant', 'revoke'].includes(overrideType)) {
      return apiResponse.badRequest(res, 'Override type must be "grant" or "revoke"');
    }

    if (!actions || typeof actions !== 'object') {
      return apiResponse.badRequest(res, 'Actions object is required (view, create, edit, delete)');
    }

    // Validate permission exists
    const permResult = await sql`
      SELECT key FROM access_permissions WHERE key = ${permissionKey} AND is_active = true
    `;
    if (permResult.length === 0) {
      return apiResponse.badRequest(res, `Invalid permission key: ${permissionKey}`);
    }

    // Apply override
    if (overrideType === 'grant') {
      await grantUserPermission(
        userId,
        permissionKey,
        actions,
        req.user.id,
        reason,
        expiresAt ? new Date(expiresAt) : undefined
      );
    } else {
      await revokeUserPermission(
        userId,
        permissionKey,
        actions,
        req.user.id,
        reason
      );
    }

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'permission_override',
        'user_permission',
        ${userId},
        ${JSON.stringify({ permissionKey, overrideType, actions, reason })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    return apiResponse.success(res, {
      message: `Permission ${overrideType === 'grant' ? 'granted' : 'revoked'} successfully`,
      permissionKey,
      overrideType,
      actions,
    });
  } catch (error) {
    log.error('Error updating user permission', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleDelete(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  userId: string
) {
  try {
    const { permissionKey } = req.body;

    if (!permissionKey) {
      return apiResponse.badRequest(res, 'Permission key is required');
    }

    await removeUserPermissionOverride(userId, permissionKey);

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'permission_override_removed',
        'user_permission',
        ${userId},
        ${JSON.stringify({ permissionKey })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    return apiResponse.success(res, {
      message: 'Permission override removed (reverted to role-based)',
      permissionKey,
    });
  } catch (error) {
    log.error('Error removing user permission override', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
