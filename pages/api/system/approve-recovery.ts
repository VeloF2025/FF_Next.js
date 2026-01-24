/**
 * Recovery Approval API
 *
 * GET  /api/system/approve-recovery - Get pending approvals
 * POST /api/system/approve-recovery - Approve or reject action
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole, getSession } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { recoveryService } from '@/modules/system/services/recoveryService';
import { escalationService } from '@/modules/system/services/escalationService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return getPending(req, res);
    case 'POST':
      return processDecision(req, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}

async function getPending(req: NextApiRequest, res: NextApiResponse) {
  const { status, riskLevel, escalationLevel } = req.query;

  const filters: {
    status?: string;
    riskLevel?: 'safe' | 'moderate' | 'dangerous';
    escalationLevel?: 1 | 2 | 3;
  } = {};

  if (status) filters.status = status as string;
  if (riskLevel) filters.riskLevel = riskLevel as 'safe' | 'moderate' | 'dangerous';
  if (escalationLevel) filters.escalationLevel = parseInt(escalationLevel as string, 10) as 1 | 2 | 3;

  const pending = await escalationService.getApprovalQueue(filters);
  const pendingCount = await escalationService.getPendingCount();

  return apiResponse.success(res, {
    pending,
    pendingCount,
  });
}

async function processDecision(req: NextApiRequest, res: NextApiResponse) {
  const { pendingId, action, reason } = req.body;
  const session = await getSession(req, res);

  if (!pendingId) {
    return apiResponse.badRequest(res, 'Pending ID is required');
  }

  if (!action || !['approve', 'reject'].includes(action)) {
    return apiResponse.badRequest(res, 'Action must be "approve" or "reject"');
  }

  const decidedBy = session?.user?.id || 'unknown';

  if (action === 'approve') {
    const result = await recoveryService.approveAction(pendingId, decidedBy, reason);

    if (!result.success && result.error?.includes('not found')) {
      return apiResponse.notFound(res, 'Approval item', pendingId);
    }

    return apiResponse.success(res, {
      approved: true,
      executed: true,
      success: result.success,
      output: result.output,
      error: result.error,
    });
  } else {
    const rejected = await recoveryService.rejectAction(pendingId, decidedBy, reason);

    if (!rejected) {
      return apiResponse.notFound(res, 'Approval item', pendingId);
    }

    return apiResponse.success(res, {
      rejected: true,
      reason,
    });
  }
}

export default withAuth(withRole('super_admin')(withErrorHandler(handler)));
