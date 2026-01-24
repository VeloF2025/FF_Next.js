/**
 * Approval Documents API
 * GET /api/pipeline/approvals/[id]/documents - List documents
 * POST /api/pipeline/approvals/[id]/documents - Upload document metadata
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineApprovalService } from '@/modules/pipeline/services/pipelineApprovalService';
import type { UploadApprovalDocumentInput } from '@/modules/pipeline/types';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Approval ID is required');
  }

  // Verify approval exists
  const approval = await pipelineApprovalService.getApprovalById(id);
  if (!approval) {
    return apiResponse.notFound(res, 'Approval', id);
  }

  if (req.method === 'GET') {
    const documents = await pipelineApprovalService.getApprovalDocuments(id);
    return apiResponse.success(res, { documents });
  }

  if (req.method === 'POST') {
    const input = req.body as UploadApprovalDocumentInput;

    // Validate required fields
    if (!input.document_type) {
      return apiResponse.badRequest(res, 'Document type is required');
    }
    if (!input.document_name) {
      return apiResponse.badRequest(res, 'Document name is required');
    }
    if (!input.file_name) {
      return apiResponse.badRequest(res, 'File name is required');
    }
    if (!input.uploaded_by) {
      return apiResponse.badRequest(res, 'Uploaded by user ID is required');
    }

    // Set the approval_id from the URL
    const documentInput: UploadApprovalDocumentInput = {
      ...input,
      approval_id: id,
    };

    const document = await pipelineApprovalService.uploadDocument(documentInput);

    return apiResponse.success(res, {
      message: 'Document uploaded successfully',
      document,
    });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

export default withAuth(withErrorHandler(handler));
