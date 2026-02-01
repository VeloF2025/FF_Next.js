/**
 * Staff Access Level API
 * GET /api/staff/access-level - Get current user's access level for staff data
 * GET /api/staff/access-level?staffId=xxx - Get access level for a specific staff record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { checkStaffAccess } from '@/services/staff/staffAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const userId = authReq.user.id;
  const staffId = req.query.staffId as string | undefined;

  try {
    const access = await checkStaffAccess(userId, staffId);

    return res.status(200).json({
      success: true,
      data: {
        level: access.level,
        canViewSensitive: access.canViewSensitive,
        canEditSensitive: access.canEditSensitive,
        isSelfView: access.isSelfView,
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to check access level'
    });
  }
}

export default withAuth(handler);
