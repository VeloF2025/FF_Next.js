/**
 * User Profile API
 * GET /api/users/profile - Get current user profile with linked staff info
 * PATCH /api/users/profile - Update user profile
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth/middleware';
import { AuthenticatedRequest } from '@/lib/auth/types';
import logger from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface UserProfile {
  // User fields
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  department?: string;
  profilePicture?: string;
  lastLogin?: string;
  createdAt: string;

  // Linked staff fields
  staffId?: string;
  employeeId?: string;
  position?: string;
  phone?: string;
  alternatePhone?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  hireDate?: string;
  birthDate?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  skills?: string[];
  certifications?: Array<{
    name: string;
    issuedDate?: string;
    expiryDate?: string;
  }>;
  contractType?: string;
  availabilityStatus?: string;
}

async function handler(
  req: NextApiRequest & AuthenticatedRequest,
  res: NextApiResponse
) {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
  }

  if (req.method === 'GET') {
    return getProfile(userId, res);
  } else if (req.method === 'PATCH') {
    return updateProfile(userId, req.body, res);
  }

  return res.status(405).json({
    success: false,
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and PATCH allowed' },
  });
}

async function getProfile(userId: string, res: NextApiResponse) {
  try {
    // Get user with linked staff data
    const result = await sql`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.role,
        u.department,
        u.profile_picture,
        u.last_login,
        u.created_at,
        s.id as staff_id,
        s.employee_id,
        s.position,
        s.phone,
        s.alternate_phone,
        s.address,
        s.city,
        s.country,
        s.postal_code,
        s.join_date as hire_date,
        s.date_of_birth as birth_date,
        s.emergency_contact,
        s.skills,
        s.certifications,
        s.contract_type,
        s.status as availability_status
      FROM users u
      LEFT JOIN staff s ON s.user_id = u.id
      WHERE u.id = ${userId}
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const row = result[0]!;
    const profile: UserProfile = {
      id: String(row.id),
      email: String(row.email),
      firstName: String(row.first_name || ''),
      lastName: String(row.last_name || ''),
      role: String(row.role),
      department: row.department ? String(row.department) : undefined,
      profilePicture: row.profile_picture ? String(row.profile_picture) : undefined,
      lastLogin: row.last_login ? String(row.last_login) : undefined,
      createdAt: String(row.created_at),
      staffId: row.staff_id ? String(row.staff_id) : undefined,
      employeeId: row.employee_id ? String(row.employee_id) : undefined,
      position: row.position ? String(row.position) : undefined,
      phone: row.phone ? String(row.phone) : undefined,
      alternatePhone: row.alternate_phone ? String(row.alternate_phone) : undefined,
      address: row.address ? String(row.address) : undefined,
      city: row.city ? String(row.city) : undefined,
      country: row.country ? String(row.country) : undefined,
      postalCode: row.postal_code ? String(row.postal_code) : undefined,
      hireDate: row.hire_date ? String(row.hire_date) : undefined,
      birthDate: row.birth_date ? String(row.birth_date) : undefined,
      emergencyContact: row.emergency_contact as UserProfile['emergencyContact'],
      skills: row.skills as string[] | undefined,
      certifications: row.certifications as UserProfile['certifications'],
      contractType: row.contract_type ? String(row.contract_type) : undefined,
      availabilityStatus: row.availability_status ? String(row.availability_status) : undefined,
    };

    return res.status(200).json({
      success: true,
      data: profile,
    });

  } catch (error) {
    logger.error('Error fetching profile', { userId, error });
    return res.status(500).json({
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch profile' },
    });
  }
}

interface ProfileUpdateData {
  firstName?: string;
  lastName?: string;
  phone?: string;
  alternatePhone?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
}

async function updateProfile(
  userId: string,
  data: ProfileUpdateData,
  res: NextApiResponse
) {
  try {
    // Get staff record linked to user
    const staffResult = await sql`
      SELECT id FROM staff WHERE user_id = ${userId}
    `;

    // Update users table (name fields)
    if (data.firstName !== undefined || data.lastName !== undefined) {
      await sql`
        UPDATE users
        SET
          first_name = COALESCE(${data.firstName ?? null}, first_name),
          last_name = COALESCE(${data.lastName ?? null}, last_name),
          updated_at = NOW()
        WHERE id = ${userId}
      `;
    }

    // Update staff table if linked
    if (staffResult.length > 0) {
      const staffId = staffResult[0]!.id;
      const emergencyContactJson = data.emergencyContact ? JSON.stringify(data.emergencyContact) : null;

      await sql`
        UPDATE staff
        SET
          first_name = COALESCE(${data.firstName ?? null}, first_name),
          last_name = COALESCE(${data.lastName ?? null}, last_name),
          phone = COALESCE(${data.phone ?? null}, phone),
          alternate_phone = COALESCE(${data.alternatePhone ?? null}, alternate_phone),
          address = COALESCE(${data.address ?? null}, address),
          city = COALESCE(${data.city ?? null}, city),
          country = COALESCE(${data.country ?? null}, country),
          postal_code = COALESCE(${data.postalCode ?? null}, postal_code),
          emergency_contact = COALESCE(${emergencyContactJson}::jsonb, emergency_contact),
          updated_at = NOW()
        WHERE id = ${staffId}
      `;
    }

    logger.info('Profile updated', { userId });

    // Return updated profile
    return getProfile(userId, res);

  } catch (error) {
    logger.error('Error updating profile', { userId, error });
    return res.status(500).json({
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update profile' },
    });
  }
}

export default withAuth(handler);
