/**
 * User Permissions API
 * GET /api/admin/permissions/me - Get current user's effective permissions
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getUserEffectivePermissions } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  try {
    const userId = req.user.id;
    const permissions = await getUserEffectivePermissions(userId);

    return apiResponse.success(res, permissions);
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
