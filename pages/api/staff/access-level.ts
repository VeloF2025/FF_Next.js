/**
 * Staff Access Level API
 * GET /api/staff/access-level?[staffId=xxx]
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { checkStaffAccess } from '@/services/staff/staffAccessService';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user.id;
  const staffId = req.query.staffId as string | undefined;

  try {
    const access = await checkStaffAccess(userId, staffId);
    return apiResponse.success(res, {
      level: access.level,
      canViewSensitive: access.canViewSensitive,
      canEditSensitive: access.canEditSensitive,
      isSelfView: access.isSelfView,
    });
  } catch (error) {
    log.error('staff-access-level GET', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
