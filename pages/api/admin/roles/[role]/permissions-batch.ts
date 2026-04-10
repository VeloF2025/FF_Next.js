/**
 * Batch Role Permissions API
 * PUT /api/admin/roles/[role]/permissions-batch - Replace all permissions for a role
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { batchUpdateRolePermissions } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';
import log from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface PermissionEntry {
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

  const { role } = req.query;
  if (!role || typeof role !== 'string') {
    return apiResponse.badRequest(res, 'Role name is required');
  }

  // Prevent modifying super_admin
  if (role === 'super_admin') {
    return apiResponse.badRequest(res, 'Cannot modify super_admin role permissions');
  }

  // Validate role exists
  const roleData = await sql`
    SELECT id, name, display_name, is_system
    FROM custom_roles WHERE name = ${role}
  `;
  if (roleData.length === 0) {
    return apiResponse.notFound(res, 'Role', role);
  }

  try {
    const { permissions } = req.body as { permissions: PermissionEntry[] };

    if (!Array.isArray(permissions)) {
      return apiResponse.badRequest(res, 'permissions must be an array of { key, actions }');
    }

    // Validate all permission keys exist
    const allPermKeys = await sql`
      SELECT key FROM access_permissions WHERE is_active = true
    `;
    const validKeys = new Set(allPermKeys.map(p => p.key));

    const invalidKeys = permissions
      .filter(p => !validKeys.has(p.key))
      .map(p => p.key);

    if (invalidKeys.length > 0) {
      return apiResponse.badRequest(
        res,
        `Invalid permission keys: ${invalidKeys.slice(0, 5).join(', ')}${invalidKeys.length > 5 ? '...' : ''}`
      );
    }

    // Batch update
    const insertedCount = await batchUpdateRolePermissions(role, permissions);

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'role_permissions_batch_update',
        'role',
        ${roleData[0]!.id}::uuid,
        ${JSON.stringify({
          role,
          permissionsUpdated: permissions.length,
          permissionsInserted: insertedCount,
          changedBy: req.user.email,
        })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    log.info({ role, count: insertedCount }, 'Role permissions batch updated');

    return apiResponse.success(res, {
      message: `Role "${role}" permissions updated`,
      permissionsSet: insertedCount,
    });
  } catch (error) {
    log.error({ error, role }, 'Error batch updating role permissions');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
