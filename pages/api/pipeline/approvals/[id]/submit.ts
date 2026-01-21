/**
 * Submit Approval Application API
 * POST /api/pipeline/approvals/[id]/submit - Submit application to authority
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import type { SubmitApplicationInput } from '@/modules/pipeline/types';

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

  // Check internal approval status (must be ops_approved before external submission)
  if (existing.internal_status !== 'ops_approved') {
    return apiResponse.badRequest(
      res,
      `Cannot submit application. Internal approval status is '${existing.internal_status}'. ` +
        `Application must be approved by Operations Manager first.`
    );
  }

  const input = req.body as SubmitApplicationInput;

  if (!input.application_date) {
    return apiResponse.badRequest(res, 'Application date is required');
  }
  if (!input.updated_by) {
    return apiResponse.badRequest(res, 'Updated by user ID is required');
  }

  const updated = await pipelineApprovalService.submitApplication(id, input);

  if (!updated) {
    return apiResponse.internalError(res, new Error('Failed to submit application'));
  }

  const approvalWithType = await pipelineApprovalService.getApprovalById(id);

  return apiResponse.success(res, {
    message: 'Application submitted successfully',
    approval: approvalWithType,
  });
}

export default withErrorHandler(handler);
