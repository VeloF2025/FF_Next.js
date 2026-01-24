/**
 * Internal Approval API
 * POST /api/pipeline/approvals/[id]/internal-approve
 * Handle PM and Ops Manager internal approval before external submission
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import type { InternalApproveInput } from '@/modules/pipeline/types';
import { withAuth } from '@/lib/auth';

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

  const input = req.body as InternalApproveInput;

  if (!input.action) {
    return apiResponse.badRequest(res, 'Action is required (pm_approve, ops_approve, or reject)');
  }
  if (!input.approved_by) {
    return apiResponse.badRequest(res, 'Approved by user ID is required');
  }

  // Validate action is allowed based on current status
  if (input.action === 'pm_approve' && existing.internal_status !== 'pending') {
    return apiResponse.badRequest(
      res,
      `Cannot PM approve. Current internal status is '${existing.internal_status}'. ` +
        `PM approval is only allowed when status is 'pending'.`
    );
  }

  if (input.action === 'ops_approve' && existing.internal_status !== 'pm_approved') {
    return apiResponse.badRequest(
      res,
      `Cannot Ops approve. Current internal status is '${existing.internal_status}'. ` +
        `Ops approval is only allowed when status is 'pm_approved'.`
    );
  }

  if (input.action === 'reject' && !input.rejection_reason) {
    return apiResponse.badRequest(res, 'Rejection reason is required when rejecting');
  }

  const updated = await pipelineApprovalService.internalApprove(id, input);

  if (!updated) {
    return apiResponse.internalError(res, new Error('Failed to process internal approval'));
  }

  const approvalWithType = await pipelineApprovalService.getApprovalById(id);

  const actionMessages = {
    pm_approve: 'Approved by Project Manager',
    ops_approve: 'Approved by Operations Manager. Ready for external submission.',
    reject: 'Rejected internally',
  };

  return apiResponse.success(res, {
    message: actionMessages[input.action],
    approval: approvalWithType,
  });
}

export default withAuth(withErrorHandler(handler));
