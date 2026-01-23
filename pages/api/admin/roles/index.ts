/**
 * Roles API
 * GET /api/admin/roles - List all roles with their permissions
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getRoles, getRolePermissions } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  try {
    const roles = await getRoles();

    // Get permissions for each role
    const rolesWithPermissions = await Promise.all(
      roles.map(async (role) => {
        const permissions = await getRolePermissions(role);

        // Count users with this role
        const userCountResult = await sql`
          SELECT COUNT(*) as count FROM users WHERE role = ${role}
        `;
        const userCount = parseInt(userCountResult[0].count) || 0;

        return {
          name: role,
          displayName: role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          permissions,
          userCount,
        };
      })
    );

    return apiResponse.success(res, {
      roles: rolesWithPermissions,
      total: roles.length,
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
