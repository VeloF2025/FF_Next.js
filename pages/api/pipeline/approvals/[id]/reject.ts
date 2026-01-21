/**
 * Mark Approval as Rejected API
 * POST /api/pipeline/approvals/[id]/reject - Mark approval as rejected by authority
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import type { RejectApprovalInput } from '@/modules/pipeline/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Approval ID is required');
  }

  const existing = await pipelineApprovalService.getApprovalById(id);
  if (!existing) {
    return apiResponse.notFound(res, 'Approval', id);
  }

  const input = req.body as RejectApprovalInput;

  if (!input.rejection_date) {
    return apiResponse.badRequest(res, 'Rejection date is required');
  }
  if (!input.rejection_reason) {
    return apiResponse.badRequest(res, 'Rejection reason is required');
  }
  if (!input.updated_by) {
    return apiResponse.badRequest(res, 'Updated by user ID is required');
  }

  const updated = await pipelineApprovalService.markRejected(id, input);

  if (!updated) {
    return apiResponse.internalError(res, new Error('Failed to mark rejection'));
  }

  const approvalWithType = await pipelineApprovalService.getApprovalById(id);

  return apiResponse.success(res, {
    message: 'Approval marked as rejected',
    approval: approvalWithType,
  });
}

export default withErrorHandler(handler);
