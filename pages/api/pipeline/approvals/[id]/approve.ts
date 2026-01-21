/**
 * Mark Approval as Approved API
 * POST /api/pipeline/approvals/[id]/approve - Mark approval as approved by authority
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import { pipelineProjectService } from '@/modules/pipeline/services/pipelineProjectService';
import type { ApproveApprovalInput } from '@/modules/pipeline/types';

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

  const input = req.body as ApproveApprovalInput;

  if (!input.approval_date) {
    return apiResponse.badRequest(res, 'Approval date is required');
  }
  if (!input.approval_reference) {
    return apiResponse.badRequest(res, 'Approval reference is required');
  }
  if (!input.updated_by) {
    return apiResponse.badRequest(res, 'Updated by user ID is required');
  }

  const updated = await pipelineApprovalService.markApproved(id, input);

  if (!updated) {
    return apiResponse.internalError(res, new Error('Failed to mark approval'));
  }

  // Check if all approvals are now complete
  const status = await pipelineApprovalService.checkAllApprovalsComplete(
    existing.pipeline_project_id
  );

  // If all complete, update project status
  if (status.complete) {
    await pipelineProjectService.updateStatus(
      existing.pipeline_project_id,
      'approvals_complete',
      input.updated_by
    );
  }

  const approvalWithType = await pipelineApprovalService.getApprovalById(id);

  return apiResponse.success(res, {
    message: 'Approval marked as approved',
    approval: approvalWithType,
    project_status: status,
  });
}

export default withErrorHandler(handler);
