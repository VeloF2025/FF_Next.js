/**
 * Users API
 * GET /api/admin/users - List all users with roles
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
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
    const { search, role, status } = req.query;

    let query = sql`
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
        s.position,
        s.phone
      FROM users u
      LEFT JOIN staff s ON s.user_id = u.id
      WHERE 1=1
    `;

    // Build dynamic query based on filters
    const users = await sql`
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
        s.position,
        s.phone
      FROM users u
      LEFT JOIN staff s ON s.user_id = u.id
      WHERE
        (${!search} OR u.email ILIKE ${'%' + (search || '') + '%'} OR u.first_name ILIKE ${'%' + (search || '') + '%'} OR u.last_name ILIKE ${'%' + (search || '') + '%'})
        AND (${!role} OR u.role = ${role})
        AND (${status === undefined} OR u.is_active = ${status === 'active'})
      ORDER BY u.created_at DESC
    `;

    // Get role display names
    const rolesResult = await sql`SELECT DISTINCT role FROM users ORDER BY role`;
    const availableRoles = rolesResult.map(r => r.role);

    return apiResponse.success(res, {
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        fullName: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email,
        role: u.role,
        roleDisplayName: (u.role || 'viewer').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        department: u.department,
        position: u.position,
        phone: u.phone,
        isActive: u.is_active,
        profilePicture: u.profile_picture,
        createdAt: u.created_at,
        lastLogin: u.last_login,
      })),
      total: users.length,
      roles: availableRoles,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
