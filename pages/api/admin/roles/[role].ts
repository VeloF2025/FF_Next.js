/**
 * Single Role API
 * GET /api/admin/roles/[role] - Get role details with permissions
 * PATCH /api/admin/roles/[role] - Update role permission template
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getRolePermissions, updateRolePermission } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

// Valid system roles
const VALID_ROLES = ['super_admin', 'admin', 'manager', 'technician', 'viewer', 'contractor'];

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  const { role } = req.query;

  if (!role || typeof role !== 'string') {
    return apiResponse.badRequest(res, 'Role name is required');
  }

  // Validate role name
  if (!VALID_ROLES.includes(role)) {
    return apiResponse.badRequest(res, `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  if (req.method === 'GET') {
    return handleGet(req, res, role);
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, res, role);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
}

async function handleGet(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  role: string
) {
  try {
    const permissions = await getRolePermissions(role);

    // Count users with this role
    const userCountResult = await sql`
      SELECT COUNT(*) as count FROM users WHERE role = ${role}
    `;
    const userCount = parseInt(userCountResult[0].count) || 0;

    return apiResponse.success(res, {
      role,
      displayName: role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      permissions,
      userCount,
    });
  } catch (error) {
    console.error('Error fetching role:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePatch(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  role: string
) {
  try {
    const { permissionKey, actions } = req.body;

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
        ${null}::uuid,
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
    console.error('Error updating role permission:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
