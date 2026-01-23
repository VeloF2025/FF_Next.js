/**
 * Current User API
 * GET /api/auth/me
 * Returns the currently authenticated user
 */

import type { NextApiResponse } from 'next';
import {
  withAuth,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth';

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' },
    });
  }

  // User is already attached by withAuth middleware
  const { user } = req;

  return res.status(200).json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        permissions: user.permissions,
        profilePicture: user.profilePicture,
        department: user.department,
      },
    },
  });
}

export default withAuth(handler);
