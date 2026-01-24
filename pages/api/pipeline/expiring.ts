/**
 * Expiring Approvals API
 * GET /api/pipeline/expiring - Get approvals expiring within X days
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { days = '90' } = req.query;
  const daysAhead = Math.min(365, Math.max(1, parseInt(String(days), 10) || 90));

  const approvals = await pipelineApprovalService.getExpiringApprovals(daysAhead);

  // Group by urgency
  const grouped = {
    expired: approvals.filter((a) => a.urgency === 'expired'),
    critical: approvals.filter((a) => a.urgency === 'critical'),
    warning: approvals.filter((a) => a.urgency === 'warning'),
    upcoming: approvals.filter((a) => a.urgency === 'upcoming'),
  };

  return apiResponse.success(res, {
    total: approvals.length,
    by_urgency: grouped,
    all: approvals,
  });
}

export default withAuth(withErrorHandler(handler));
