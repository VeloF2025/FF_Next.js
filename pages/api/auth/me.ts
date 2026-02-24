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
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  // User is already attached by withAuth middleware
  const { user } = req;

  return apiResponse.success(res, {
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

export default withAuth(withErrorHandler(handler));
