/**
 * Pipeline Approval Detail API
 * GET /api/pipeline/approvals/[id] - Get approval details
 * PUT /api/pipeline/approvals/[id] - Update approval
 * DELETE /api/pipeline/approvals/[id] - Delete approval
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import type { UpdateApprovalInput } from '@/modules/pipeline/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Approval ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, id);
    case 'PUT':
      return handlePut(req, res, id);
    case 'DELETE':
      return handleDelete(req, res, id);
    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  const approval = await pipelineApprovalService.getApprovalById(id);

  if (!approval) {
    return apiResponse.notFound(res, 'Approval', id);
  }

  // Get documents
  const documents = await pipelineApprovalService.getApprovalDocuments(id);

  return apiResponse.success(res, {
    ...approval,
    documents,
  });
}

async function handlePut(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  const existing = await pipelineApprovalService.getApprovalById(id);
  if (!existing) {
    return apiResponse.notFound(res, 'Approval', id);
  }

  const input = req.body as UpdateApprovalInput;
  const updated = await pipelineApprovalService.updateApproval(id, input);

  if (!updated) {
    return apiResponse.internalError(res, new Error('Failed to update approval'));
  }

  const approvalWithType = await pipelineApprovalService.getApprovalById(id);

  return apiResponse.success(res, approvalWithType);
}

async function handleDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  const success = await pipelineApprovalService.deleteApproval(id);

  if (!success) {
    return apiResponse.notFound(res, 'Approval', id);
  }

  return apiResponse.success(res, { message: 'Approval deleted successfully' });
}

export default withErrorHandler(handler);
