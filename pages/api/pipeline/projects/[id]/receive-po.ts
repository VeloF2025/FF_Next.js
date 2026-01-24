/**
 * Pipeline Project Receive PO API
 * POST /api/pipeline/projects/[id]/receive-po - Mark PO as received
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineProjectService } from '@/modules/pipeline/services/pipelineProjectService';
import type { ReceivePOInput } from '@/modules/pipeline/types';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  const input = req.body as ReceivePOInput;

  // Validate required fields
  if (!input.po_number?.trim()) {
    return apiResponse.badRequest(res, 'PO number is required');
  }
  if (!input.po_date) {
    return apiResponse.badRequest(res, 'PO date is required');
  }
  if (input.po_value === undefined || input.po_value === null) {
    return apiResponse.badRequest(res, 'PO value is required');
  }
  if (!input.po_received_by) {
    return apiResponse.badRequest(res, 'Received by user ID is required');
  }

  // Check project exists
  const existing = await pipelineProjectService.getProjectById(id);
  if (!existing) {
    return apiResponse.notFound(res, 'Pipeline project', id);
  }

  // Check project status allows PO receipt
  const allowedStatuses = ['approvals_complete', 'po_pending'];
  if (!allowedStatuses.includes(existing.pipeline_status)) {
    return apiResponse.badRequest(
      res,
      `Cannot receive PO for project in status: ${existing.pipeline_status}. ` +
        `Project must be in 'approvals_complete' or 'po_pending' status.`
    );
  }

  // Update with PO
  const updated = await pipelineProjectService.receivePO(id, input);

  if (!updated) {
    return apiResponse.internalError(res, new Error('Failed to update project with PO'));
  }

  // Fetch with relations
  const projectWithRelations = await pipelineProjectService.getProjectById(id);

  return apiResponse.success(res, {
    message: 'PO received successfully. Project is now ready to plan.',
    project: projectWithRelations,
  });
}

export default withAuth(withErrorHandler(handler));
