/**
 * Bulk Internal Approve API
 * POST /api/pipeline/projects/[id]/bulk-internal-approve
 * 
 * Marks all pending internal approvals as ops_approved for a project.
 * Used for Smartsheet-imported projects where external approvals exist
 * but internal review was skipped.
 * 
 * Also auto-transitions pipeline_status to approvals_complete if all
 * approvals are now externally approved.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import { pipelineProjectService } from '@/modules/pipeline/services/pipelineProjectService';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // Verify project exists
  const project = await pipelineProjectService.getProjectById(id);
  if (!project) {
    return apiResponse.notFound(res, 'Pipeline project', id);
  }

  const { approved_by, notes } = req.body || {};

  if (!approved_by) {
    return apiResponse.badRequest(res, 'approved_by is required');
  }

  // Bulk update all pending internal approvals that are already externally approved
  const result = (await sql`
    UPDATE pipeline_project_approvals
    SET
      internal_status = 'ops_approved',
      pm_approved_by = ${approved_by},
      pm_approved_at = NOW(),
      ops_approved_by = ${approved_by},
      ops_approved_at = NOW(),
      pm_notes = ${notes || 'Bulk approved (Smartsheet import)'},
      ops_notes = ${notes || 'Bulk approved (Smartsheet import)'},
      updated_at = NOW(),
      updated_by = ${approved_by}
    WHERE pipeline_project_id = ${id}
      AND status IN ('approved', 'conditionally_approved')
      AND internal_status IN ('pending', 'pm_approved')
    RETURNING id, (SELECT name FROM pipeline_approval_types WHERE id = approval_type_id) as type_name
  `) as Record<string, unknown>[];

  log.info('BulkInternalApprove', `Bulk approved ${result.length} approvals for project ${id}`, {
    projectId: id,
    count: result.length,
    approvedBy: approved_by,
  });

  // Check if all approvals are now complete and auto-transition
  const status = await pipelineApprovalService.checkAllApprovalsComplete(id);

  if (status.complete && project.pipeline_status === 'approvals_in_progress') {
    await pipelineProjectService.updateStatus(id, 'approvals_complete', approved_by);
    log.info('BulkInternalApprove', `Auto-transitioned project ${id} to approvals_complete`);
  }

  return apiResponse.success(res, {
    message: `Bulk internal approval complete. ${result.length} approvals updated.`,
    updated_count: result.length,
    updated_approvals: result.map((r) => r.type_name),
    project_status: status,
    auto_transitioned: status.complete && project.pipeline_status === 'approvals_in_progress',
  });
}

export default withAuth(withErrorHandler(handler));
