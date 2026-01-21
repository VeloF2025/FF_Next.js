/**
 * Single Document API
 * DELETE /api/pipeline/approvals/[id]/documents/[docId] - Delete document
 * POST /api/pipeline/approvals/[id]/documents/[docId]/verify - Verify document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import type { VerifyDocumentInput } from '@/modules/pipeline/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id, docId } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Approval ID is required');
  }

  if (!docId || typeof docId !== 'string') {
    return apiResponse.badRequest(res, 'Document ID is required');
  }

  // Verify approval exists
  const approval = await pipelineApprovalService.getApprovalById(id);
  if (!approval) {
    return apiResponse.notFound(res, 'Approval', id);
  }

  if (req.method === 'DELETE') {
    const deleted = await pipelineApprovalService.deleteDocument(docId);

    if (!deleted) {
      return apiResponse.notFound(res, 'Document', docId);
    }

    return apiResponse.success(res, {
      message: 'Document deleted successfully',
    });
  }

  if (req.method === 'POST') {
    // Check if this is a verify action
    const input = req.body as VerifyDocumentInput;

    if (!input.verified_by) {
      return apiResponse.badRequest(res, 'Verified by user ID is required');
    }

    const document = await pipelineApprovalService.verifyDocument(docId, {
      is_verified: input.is_verified ?? true,
      verification_notes: input.verification_notes,
      verified_by: input.verified_by,
    });

    if (!document) {
      return apiResponse.notFound(res, 'Document', docId);
    }

    return apiResponse.success(res, {
      message: input.is_verified ? 'Document verified' : 'Document verification removed',
      document,
    });
  }

  res.setHeader('Allow', ['DELETE', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

export default withErrorHandler(handler);
