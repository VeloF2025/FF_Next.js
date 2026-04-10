/**
 * Clone Role API
 * POST /api/admin/roles/clone - Clone an existing role with all its permissions
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
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
    const { sourceRole, newName, newDisplayName, description } = req.body;

    // Validate required fields
    if (!sourceRole || typeof sourceRole !== 'string') {
      return apiResponse.badRequest(res, 'Source role name is required');
    }

    if (!newName || typeof newName !== 'string') {
      return apiResponse.badRequest(res, 'New role name is required');
    }

    if (!newDisplayName || typeof newDisplayName !== 'string') {
      return apiResponse.badRequest(res, 'New display name is required');
    }

    // Validate name format (lowercase, no spaces, alphanumeric + underscore)
    const nameRegex = /^[a-z][a-z0-9_]*$/;
    if (!nameRegex.test(newName)) {
      return apiResponse.badRequest(
        res,
        'Role name must be lowercase, start with a letter, and contain only letters, numbers, and underscores'
      );
    }

    // Check if source role exists
    const sourceRoleData = await sql`
      SELECT id, name, display_name FROM custom_roles WHERE name = ${sourceRole}
    `;
    if (sourceRoleData.length === 0) {
      return apiResponse.notFound(res, 'Source role', sourceRole);
    }

    // Check if new name already exists
    const existingRole = await sql`
      SELECT id FROM custom_roles WHERE name = ${newName}
    `;
    if (existingRole.length > 0) {
      return apiResponse.badRequest(res, `Role "${newName}" already exists`);
    }

    // Use the database function to clone the role
    const result = await sql`
      SELECT clone_role(
        ${sourceRole},
        ${newName},
        ${newDisplayName},
        ${description || `Cloned from ${sourceRoleData[0]!.display_name}`},
        ${req.user.id}
      ) as new_role_id
    `;

    const newRoleId = result[0]!.new_role_id;

    // Get the new role data
    const newRoleData = await sql`
      SELECT id, name, display_name, description, color, is_system, is_active, sort_order, created_at
      FROM custom_roles
      WHERE id = ${newRoleId}
    `;

    // Count permissions that were cloned
    const permCount = await sql`
      SELECT COUNT(*) as count FROM role_permissions WHERE role = ${newName}
    `;

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'role_clone',
        'role',
        ${newRoleId},
        ${JSON.stringify({
          sourceRole,
          newName,
          newDisplayName,
          permissionsCloned: parseInt(permCount[0]!.count),
          clonedBy: req.user.email,
        })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    log.info({ newRoleId, sourceRole, newName }, 'Role cloned successfully');

    return apiResponse.created(res, {
      id: newRoleData[0]!.id,
      name: newRoleData[0]!.name,
      displayName: newRoleData[0]!.display_name,
      description: newRoleData[0].description,
      color: newRoleData[0].color,
      isSystem: newRoleData[0].is_system,
      isActive: newRoleData[0].is_active,
      sortOrder: newRoleData[0].sort_order,
      createdAt: newRoleData[0].created_at,
      permissionsCloned: parseInt(permCount[0]!.count),
      clonedFrom: sourceRole,
    });
  } catch (error) {
    log.error('roles-clone', { error: error instanceof Error ? error.message : String(error) });
    // Handle specific PostgreSQL errors from the clone_role function
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('does not exist')) {
      return apiResponse.notFound(res, 'Source role', req.body.sourceRole);
    }
    if (errorMessage.includes('already exists')) {
      return apiResponse.badRequest(res, `Role "${req.body.newName}" already exists`);
    }

    log.error({ error }, 'Error cloning role');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
