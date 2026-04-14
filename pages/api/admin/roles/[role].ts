/**
 * Single Role API
 * GET /api/admin/roles/[role] - Get role details with permissions
 * PATCH /api/admin/roles/[role] - Update role permission template
 * DELETE /api/admin/roles/[role] - Delete a custom role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getRolePermissions, updateRolePermission } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';

const log = createLogger('RolesAPI');

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  const { role } = req.query;

  if (!role || typeof role !== 'string') {
    return apiResponse.badRequest(res, 'Role name is required');
  }

  // Validate role exists in custom_roles table
  const roleData = await sql`
    SELECT id, name, display_name, description, color, is_system, is_active
    FROM custom_roles
    WHERE name = ${role}
  `;

  if (roleData.length === 0) {
    return apiResponse.notFound(res, 'Role', role);
  }

  const roleRecord = roleData[0] as unknown as RoleRecord;

  if (req.method === 'GET') {
    return handleGet(req, res, role, roleRecord);
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, res, role, roleRecord);
  }

  if (req.method === 'DELETE') {
    return handleDelete(req, res, role, roleRecord);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
}

interface RoleRecord {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  color: string;
  is_system: boolean;
  is_active: boolean;
}

async function handleGet(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  role: string,
  roleRecord: RoleRecord
) {
  try {
    const permissions = await getRolePermissions(role);

    // Count users with this role
    const userCountResult = await sql`
      SELECT COUNT(*) as count FROM users WHERE role = ${role}
    `;
    const userCount = parseInt(userCountResult[0]!.count) || 0;

    return apiResponse.success(res, {
      id: roleRecord.id,
      name: roleRecord.name,
      displayName: roleRecord.display_name,
      description: roleRecord.description,
      color: roleRecord.color,
      isSystem: roleRecord.is_system,
      isActive: roleRecord.is_active,
      permissions,
      userCount,
    });
  } catch (error) {
    log.error('Error fetching role', { error, role });
    return apiResponse.internalError(res, error);
  }
}

async function handlePatch(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  role: string,
  roleRecord: RoleRecord
) {
  try {
    const { permissionKey, actions, displayName, description, color } = req.body;

    // If updating role metadata (not permissions)
    if (displayName !== undefined || description !== undefined || color !== undefined) {
      // System roles can only have color updated, not name/description
      if (roleRecord.is_system && (displayName !== undefined || description !== undefined)) {
        return apiResponse.badRequest(res, 'Cannot modify system role name or description');
      }

      await sql`
        UPDATE custom_roles
        SET
          display_name = COALESCE(${displayName ?? null}, display_name),
          description = COALESCE(${description ?? null}, description),
          color = COALESCE(${color ?? null}, color),
          updated_at = NOW()
        WHERE name = ${role}
      `;

      return apiResponse.success(res, {
        message: 'Role updated successfully',
        role,
      });
    }

    // If updating permissions
    if (!permissionKey) {
      return apiResponse.badRequest(res, 'Permission key is required');
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

    // Prevent modifying super_admin permissions (they have all access)
    if (role === 'super_admin') {
      return apiResponse.badRequest(res, 'Cannot modify super_admin role permissions');
    }

    // Update role permission
    await updateRolePermission(role, permissionKey, actions);

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'role_permission_update',
        'role',
        ${roleRecord.id}::uuid,
        ${JSON.stringify({ role, permissionKey, actions, changedBy: req.user.email })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    return apiResponse.success(res, {
      message: 'Role permission updated successfully',
      role,
      permissionKey,
      actions,
    });
  } catch (error) {
    log.error('Error updating role', { error, role });
    return apiResponse.internalError(res, error);
  }
}

async function handleDelete(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  role: string,
  roleRecord: RoleRecord
) {
  try {
    // Cannot delete system roles
    if (roleRecord.is_system) {
      return apiResponse.badRequest(res, `Cannot delete system role "${role}"`);
    }

    // Check for users with this role
    const userCountResult = await sql`
      SELECT COUNT(*) as count FROM users WHERE role = ${role} AND is_active = true
    `;
    const userCount = parseInt(userCountResult[0]!.count) || 0;

    if (userCount > 0) {
      return apiResponse.badRequest(
        res,
        `Cannot delete role "${role}" - ${userCount} active user(s) have this role. Reassign them first.`
      );
    }

    // Delete role permissions first
    await sql`DELETE FROM role_permissions WHERE role = ${role}`;

    // Delete the role
    await sql`DELETE FROM custom_roles WHERE name = ${role}`;

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'role_delete',
        'role',
        ${roleRecord.id}::uuid,
        ${JSON.stringify({ role, displayName: roleRecord.display_name, deletedBy: req.user.email })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    log.info('Custom role deleted', { roleId: roleRecord.id, role });

    return apiResponse.success(res, {
      message: `Role "${role}" deleted successfully`,
    });
  } catch (error) {
    log.error('Error deleting role', { error, role });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler as (req: NextApiRequest, res: NextApiResponse) => Promise<void>));
