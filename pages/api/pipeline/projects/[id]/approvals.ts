/**
 * Pipeline Project Approvals API
 * GET /api/pipeline/projects/[id]/approvals - Get all approvals for a project
 * POST /api/pipeline/projects/[id]/approvals - Add approval to project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import { pipelineProjectService } from '@/modules/pipeline/services/pipelineProjectService';
import type { CreateApprovalInput } from '@/modules/pipeline/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // Verify project exists
  const project = await pipelineProjectService.getProjectById(id);
  if (!project) {
    return apiResponse.notFound(res, 'Pipeline project', id);
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, id);
    case 'POST':
      return handlePost(req, res, id);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

/**
 * GET /api/pipeline/projects/[id]/approvals
 * Get all approvals for a project with type info
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string
) {
  const approvals = await pipelineApprovalService.getProjectApprovals(projectId);

  // Also include completion status
  const status = await pipelineApprovalService.checkAllApprovalsComplete(projectId);

  return apiResponse.success(res, {
    approvals,
    status,
  });
}

/**
 * POST /api/pipeline/projects/[id]/approvals
 * Add a new approval requirement to the project
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string
) {
  const { approval_type_id, ...rest } = req.body;

  if (!approval_type_id) {
    return apiResponse.badRequest(res, 'Approval type ID is required');
  }

  const input: CreateApprovalInput = {
    pipeline_project_id: projectId,
    approval_type_id,
    ...rest,
  };

  const approval = await pipelineApprovalService.createApproval(input);

  // Fetch with type info
  const approvalWithType = await pipelineApprovalService.getApprovalById(approval.id);

  return apiResponse.created(res, approvalWithType);
}

export default withErrorHandler(handler);
