/**
 * Due Follow-ups API
 * GET /api/pipeline/followups - Get due and upcoming follow-ups
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

  const followups = await pipelineApprovalService.getDueFollowups();

  // Group by status
  const grouped = {
    overdue: followups.filter((f) => f.followup_status === 'overdue'),
    today: followups.filter((f) => f.followup_status === 'today'),
    upcoming: followups.filter((f) => f.followup_status === 'upcoming'),
    scheduled: followups.filter((f) => f.followup_status === 'scheduled'),
  };

  return apiResponse.success(res, {
    total: followups.length,
    by_status: grouped,
    all: followups,
  });
}

export default withAuth(withErrorHandler(handler));
