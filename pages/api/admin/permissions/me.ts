/**
 * User Permissions API
 * GET /api/admin/permissions/me - Get current user's effective permissions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getUserEffectivePermissions } from '@/lib/permissions';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const userId = authReq.user.id;
    const permissions = await getUserEffectivePermissions(userId);

    return apiResponse.success(res, permissions);
  } catch (error) {
    log.error('Error fetching user permissions', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
