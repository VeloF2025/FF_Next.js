/**
 * Provision Users from Staff API
 * POST /api/admin/users/provision-from-staff
 *
 * Creates user accounts for all staff members who don't have one yet.
 * Users are created with "pending_setup" status - they need to set a password to activate.
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { v4 as uuidv4 } from 'uuid';
import { withAuth, withRole, AuthenticatedNextApiRequest, type AuthRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// Map staff position to auth role
function mapPositionToAuthRole(position: string | null): AuthRole {
  if (!position) return 'viewer';
  const positionLower = position.toLowerCase();

  // Admin positions
  if (positionLower.includes('admin') || positionLower.includes('director') || positionLower.includes('ceo') || positionLower.includes('cso')) {
    return 'admin';
  }
  // Manager positions
  if (positionLower.includes('manager') || positionLower.includes('supervisor') || positionLower.includes('head') || positionLower.includes('lead')) {
    return 'manager';
  }
  // Technician positions
  if (positionLower.includes('technician') || positionLower.includes('installer') || positionLower.includes('engineer')) {
    return 'technician';
  }
  // Default to viewer
  return 'viewer';
}

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  try {
    // Get all staff without user accounts
    const staffWithoutUsers = await sql`
      SELECT
        s.id as staff_id,
        s.first_name,
        s.last_name,
        s.email,
        s.position,
        s.department,
        s.is_active
      FROM staff s
      WHERE s.user_id IS NULL
        AND s.email IS NOT NULL
        AND s.email != ''
        AND s.is_active = true
      ORDER BY s.first_name, s.last_name
    `;

    if (staffWithoutUsers.length === 0) {
      return apiResponse.success(res, {
        message: 'All active staff members already have user accounts',
        created: 0,
        skipped: 0,
      });
    }

    let created = 0;
    let skipped = 0;
    const errors: { email: string; error: string }[] = [];

    for (const staff of staffWithoutUsers) {
      try {
        const normalizedEmail = String(staff.email).toLowerCase().trim();

        // Check if user already exists with this email
        const existingUser = await sql`
          SELECT id FROM users WHERE email = ${normalizedEmail}
        `;

        if (existingUser.length > 0) {
          // Link existing user to staff
          await sql`
            UPDATE staff SET user_id = ${existingUser[0]!.id}, updated_at = NOW()
            WHERE id = ${staff.staff_id}
          `;
          skipped++;
          continue;
        }

        // Create new user (without password - pending setup)
        const userId = uuidv4();
        const role = mapPositionToAuthRole(staff.position as string | null);

        await sql`
          INSERT INTO users (
            id,
            email,
            password,
            first_name,
            last_name,
            role,
            permissions,
            department,
            is_active,
            created_at,
            updated_at
          ) VALUES (
            ${userId},
            ${normalizedEmail},
            NULL,
            ${staff.first_name},
            ${staff.last_name},
            ${role},
            '[]'::jsonb,
            ${staff.department},
            true,
            NOW(),
            NOW()
          )
        `;

        // Link user to staff
        await sql`
          UPDATE staff SET user_id = ${userId}, updated_at = NOW()
          WHERE id = ${staff.staff_id}
        `;

        created++;
      } catch (err) {
        logger.error('Failed to provision user for staff', {
          staffId: staff.staff_id,
          email: staff.email,
          error: err,
        });
        errors.push({
          email: String(staff.email),
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    logger.info('Staff users provisioned', {
      created,
      skipped,
      errors: errors.length,
      by: req.user.email,
    });

    return apiResponse.success(res, {
      message: `Provisioned ${created} new user accounts`,
      created,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      total: staffWithoutUsers.length,
    });
  } catch (error) {
    logger.error('Error provisioning users from staff', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
