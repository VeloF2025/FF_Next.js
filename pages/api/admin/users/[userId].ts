/**
 * Single User API
 * GET /api/admin/users/[userId] - Get user details
 * PATCH /api/admin/users/[userId] - Update user (role, status)
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getUserEffectivePermissions, getUserPermissionOverrides } from '@/lib/permissions';
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

  if (req.method === 'GET') {
    return handleGet(req, res, userId);
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, res, userId);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
}

async function handleGet(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  userId: string
) {
  try {
    // Get user details
    const userResult = await sql`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.role,
        u.department,
        u.is_active,
        u.created_at,
        u.last_login,
        u.profile_picture,
        u.permissions as legacy_permissions,
        s.position,
        s.phone,
        s.employee_id
      FROM users u
      LEFT JOIN staff s ON s.user_id = u.id
      WHERE u.id = ${userId}
    `;

    if (userResult.length === 0) {
      return apiResponse.notFound(res, 'User', userId);
    }

    const user = userResult[0]!;

    // Get effective permissions
    const permissions = await getUserEffectivePermissions(userId);

    // Get overrides
    const overrides = await getUserPermissionOverrides(userId);

    return apiResponse.success(res, {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
        role: user.role,
        roleDisplayName: (user.role || 'viewer').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        department: user.department,
        position: user.position,
        phone: user.phone,
        employeeId: user.employee_id,
        isActive: user.is_active,
        profilePicture: user.profile_picture,
        createdAt: user.created_at,
        lastLogin: user.last_login,
        legacyPermissions: user.legacy_permissions,
      },
      permissions,
      overrides,
    });
  } catch (error) {
    log.error('Error fetching user', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handlePatch(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  userId: string
) {
  try {
    const { role, isActive } = req.body;

    // Validate user exists
    const userResult = await sql`SELECT id, role FROM users WHERE id = ${userId}`;
    if (userResult.length === 0) {
      return apiResponse.notFound(res, 'User', userId);
    }

    const currentUser = userResult[0]!;

    // Prevent demoting self
    if (role && role !== 'super_admin' && userId === req.user.id) {
      return apiResponse.badRequest(res, 'You cannot demote yourself');
    }

    // Prevent removing last super_admin
    if (role && role !== 'super_admin' && currentUser.role === 'super_admin') {
      const superAdminCount = await sql`
        SELECT COUNT(*) as count FROM users WHERE role = 'super_admin' AND is_active = true
      `;
      if (parseInt(superAdminCount[0]!.count) <= 1) {
        return apiResponse.badRequest(res, 'Cannot remove the last super admin');
      }
    }

    // Build update
    const updates: string[] = [];
    const values: Record<string, unknown> = {};

    if (role !== undefined) {
      // Validate role
      const validRoles = ['super_admin', 'admin', 'manager', 'technician', 'viewer', 'contractor'];
      if (!validRoles.includes(role)) {
        return apiResponse.badRequest(res, `Invalid role. Must be one of: ${validRoles.join(', ')}`);
      }

      // Update role and permissions
      if (role === 'super_admin') {
        // Grant 'all' permission for super admin
        await sql`
          UPDATE users
          SET role = ${role}, permissions = '["all"]'::jsonb, updated_at = NOW()
          WHERE id = ${userId}
        `;
      } else {
        // Clear 'all' permission for non-super-admin
        await sql`
          UPDATE users
          SET role = ${role}, permissions = '[]'::jsonb, updated_at = NOW()
          WHERE id = ${userId}
        `;
      }
    }

    if (isActive !== undefined) {
      await sql`
        UPDATE users
        SET is_active = ${isActive}, updated_at = NOW()
        WHERE id = ${userId}
      `;
    }

    // Log audit event
    await sql`
      INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${req.user.id},
        'user_role_change',
        'user',
        ${userId},
        ${JSON.stringify({ role, isActive, changedBy: req.user.email })}::jsonb,
        ${(req.headers['x-forwarded-for'] as string)?.split(',')[0] || null}
      )
    `;

    return apiResponse.success(res, { message: 'User updated successfully' });
  } catch (error) {
    log.error('Error updating user', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
