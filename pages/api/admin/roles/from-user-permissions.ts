/**
 * Create/Update Role from User Permissions API
 * POST /api/admin/roles/from-user-permissions
 * Creates a new role or updates an existing role using a user's effective permissions
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { createRoleFromUserPermissions, updateRoleFromUserPermissions } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';
import log from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  try {
    const { userId, name, displayName, description, mode, existingRole } = req.body;

    if (!userId || typeof userId !== 'string') {
      return apiResponse.badRequest(res, 'userId is required');
    }

    if (!mode || !['create', 'update'].includes(mode)) {
      return apiResponse.badRequest(res, 'mode must be "create" or "update"');
    }

    // Verify source user exists
    const userResult = await sql`
      SELECT id, email, role FROM users WHERE id = ${userId}
    `;
    if (userResult.length === 0) {
      return apiResponse.notFound(res, 'User', userId);
    }

    if (mode === 'create') {
      // Validate required fields for create
      if (!name || typeof name !== 'string') {
        return apiResponse.badRequest(res, 'Role name is required for create mode');
      }
      if (!displayName || typeof displayName !== 'string') {
        return apiResponse.badRequest(res, 'Display name is required for create mode');
      }

      // Validate name format
      const nameRegex = /^[a-z][a-z0-9_]*$/;
      if (!nameRegex.test(name)) {
        return apiResponse.badRequest(
          res,
          'Role name must be lowercase, start with a letter, and contain only letters, numbers, and underscores'
        );
      }

      // Check if role already exists
      const existing = await sql`SELECT id FROM custom_roles WHERE name = ${name}`;
      if (existing.length > 0) {
        return apiResponse.badRequest(res, `Role "${name}" already exists`);
      }

      const result = await createRoleFromUserPermissions(
        userId,
        name,
        displayName,
        description || null,
        req.user.id
      );

      // Log audit event
      await sql`
        INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
        VALUES (
          ${req.user.id},
          'role_create_from_user',
          'role',
          ${result.roleId}::uuid,
          ${JSON.stringify({
            roleName: name,
            displayName,
            sourceUser: userResult[0]!.email,
            sourceRole: userResult[0]!.role,
            permissionCount: result.permissionCount,
            createdBy: req.user.email,
          })}::jsonb,
          ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
        )
      `;

      log.info({ roleId: result.roleId, name, sourceUser: userId }, 'Role created from user permissions');

      return apiResponse.created(res, {
        message: `Role "${displayName}" created with ${result.permissionCount} permissions`,
        roleId: result.roleId,
        name,
        displayName,
        permissionCount: result.permissionCount,
      });
    }

    // mode === 'update'
    if (!existingRole || typeof existingRole !== 'string') {
      return apiResponse.badRequest(res, 'existingRole is required for update mode');
    }

    // Cannot update super_admin
    if (existingRole === 'super_admin') {
      return apiResponse.badRequest(res, 'Cannot modify super_admin role');
    }

    // Verify role exists
    const roleData = await sql`
      SELECT id, name, display_name, is_system
      FROM custom_roles WHERE name = ${existingRole}
    `;
    if (roleData.length === 0) {
      return apiResponse.notFound(res, 'Role', existingRole);
    }

    const result = await updateRoleFromUserPermissions(userId, existingRole);

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'role_update_from_user',
        'role',
        ${roleData[0]!.id}::uuid,
        ${JSON.stringify({
          roleName: existingRole,
          sourceUser: userResult[0]!.email,
          sourceRole: userResult[0]!.role,
          permissionCount: result.permissionCount,
          updatedBy: req.user.email,
        })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    log.info(
      { role: existingRole, sourceUser: userId, perms: result.permissionCount },
      'Role updated from user permissions'
    );

    return apiResponse.success(res, {
      message: `Role "${roleData[0]!.display_name}" updated with ${result.permissionCount} permissions`,
      name: existingRole,
      displayName: roleData[0]!.display_name,
      permissionCount: result.permissionCount,
    });
  } catch (error) {
    log.error({ error }, 'Error creating/updating role from user permissions');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
