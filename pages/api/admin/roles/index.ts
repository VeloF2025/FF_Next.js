/**
 * Roles API
 * GET /api/admin/roles - List all roles with permissions and stats
 * POST /api/admin/roles - Create a new custom role
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getRolePermissions } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';
import log from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
}

async function handleGet(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  try {
    // Use the view for role stats
    const rolesData = await sql`
      SELECT
        id,
        name,
        display_name,
        description,
        color,
        is_system,
        is_active,
        sort_order,
        permission_count,
        user_count,
        created_at,
        updated_at
      FROM v_roles_with_stats
      ORDER BY sort_order
    `;

    // Get permissions for each role
    const rolesWithPermissions = await Promise.all(
      rolesData.map(async (role) => {
        const permissions = await getRolePermissions(role.name);

        return {
          id: role.id,
          name: role.name,
          displayName: role.display_name,
          description: role.description,
          color: role.color,
          isSystem: role.is_system,
          isActive: role.is_active,
          sortOrder: role.sort_order,
          permissions,
          permissionCount: parseInt(role.permission_count) || 0,
          userCount: parseInt(role.user_count) || 0,
          createdAt: role.created_at,
          updatedAt: role.updated_at,
        };
      })
    );

    return apiResponse.success(res, {
      roles: rolesWithPermissions,
      total: rolesWithPermissions.length,
    });
  } catch (error) {
    log.error({ error }, 'Error fetching roles');
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  try {
    const { name, displayName, description, color } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string') {
      return apiResponse.badRequest(res, 'Role name is required');
    }

    if (!displayName || typeof displayName !== 'string') {
      return apiResponse.badRequest(res, 'Display name is required');
    }

    // Validate name format (lowercase, no spaces, alphanumeric + underscore)
    const nameRegex = /^[a-z][a-z0-9_]*$/;
    if (!nameRegex.test(name)) {
      return apiResponse.badRequest(
        res,
        'Role name must be lowercase, start with a letter, and contain only letters, numbers, and underscores'
      );
    }

    // Check if role already exists
    const existingRole = await sql`
      SELECT id FROM custom_roles WHERE name = ${name}
    `;
    if (existingRole.length > 0) {
      return apiResponse.badRequest(res, `Role "${name}" already exists`);
    }

    // Create the role
    const newRole = await sql`
      INSERT INTO custom_roles (name, display_name, description, color, is_system, created_by)
      VALUES (
        ${name},
        ${displayName},
        ${description || null},
        ${color || '#6b7280'},
        FALSE,
        ${req.user.id}
      )
      RETURNING id, name, display_name, description, color, is_system, is_active, sort_order, created_at
    `;

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'role_create',
        'role',
        ${newRole[0].id},
        ${JSON.stringify({ name, displayName, description, createdBy: req.user.email })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    log.info({ roleId: newRole[0].id, name }, 'Custom role created');

    return apiResponse.created(res, {
      id: newRole[0].id,
      name: newRole[0].name,
      displayName: newRole[0].display_name,
      description: newRole[0].description,
      color: newRole[0].color,
      isSystem: newRole[0].is_system,
      isActive: newRole[0].is_active,
      sortOrder: newRole[0].sort_order,
      createdAt: newRole[0].created_at,
    });
  } catch (error) {
    log.error({ error }, 'Error creating role');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
