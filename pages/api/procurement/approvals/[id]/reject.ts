import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { notify } from '@/modules/notifications/services';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { id } = req.query;
  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user.id;
  const userName = authReq.user.name;
  const { reason } = req.body || {};

  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Approval request ID is required' });
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return apiResponse.validationError(res, { reason: 'Rejection reason is required' });
  }

  try {
    // Check if approval request exists and is pending
    const existing = await sql`
      SELECT ar.*, aw.workflow_type
      FROM approval_requests ar
      JOIN approval_workflows aw ON ar.workflow_id = aw.id
      WHERE ar.id = ${id}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Approval request', id);
    }

    const request = existing[0]!;

    if (request.status !== 'pending') {
      return apiResponse.validationError(res, {
        status: `Cannot reject a request that is already ${request.status}`,
      });
    }

    // Update the approval request
    const updated = await sql`
      UPDATE approval_requests
      SET
        status = 'rejected',
        responded_by = ${userId || 'system'},
        responded_by_name = ${userName || 'System User'},
        responded_at = NOW(),
        response_notes = ${reason.trim()},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    // Update the source document status
    await updateDocumentStatus(request.document_type, request.document_id, 'rejected');

    log.info({
      module: 'procurement',
      action: 'approval_rejected',
      approvalRequestId: id,
      documentType: request.document_type,
      documentId: request.document_id,
      rejectedBy: userId,
      reason: reason.trim(),
    });

    // UNS: Notify the requester that their request was rejected
    if (request.requested_by) {
      notify({
        event_type: 'procurement.rejected',
        title: `${request.document_type?.replace(/_/g, ' ')} rejected`,
        body: `Reason: ${reason.trim()}`,
        action_url: '/app/procurement/approvals',
        source_module: 'procurement',
        source_id: request.document_id,
        recipient_user_ids: [request.requested_by],
      }).catch(() => {});
    }

    return apiResponse.success(res, updated[0], 'Request rejected');
  } catch (error) {
    return apiResponse.databaseError(res, error, 'Failed to reject request');
  }
}));

async function updateDocumentStatus(
  documentType: string,
  documentId: string,
  status: 'rejected'
): Promise<void> {
  try {
    switch (documentType) {
      case 'purchase_requisition':
        await sql`
          UPDATE purchase_requisitions
          SET
            approval_status = ${status},
            status = 'rejected',
            updated_at = NOW()
          WHERE id = ${documentId}
        `;
        break;

      case 'purchase_order':
        await sql`
          UPDATE purchase_orders
          SET
            approval_status = ${status},
            status = 'rejected',
            updated_at = NOW()
          WHERE id = ${documentId}
        `;
        break;

      case 'boq':
        await sql`
          UPDATE bill_of_quantities
          SET
            status = 'rejected',
            updated_at = NOW()
          WHERE id = ${documentId}
        `;
        break;

      case 'rfq':
        await sql`
          UPDATE request_for_quotations
          SET
            status = 'cancelled',
            updated_at = NOW()
          WHERE id = ${documentId}
        `;
        break;

      case 'goods_receipt':
        await sql`
          UPDATE goods_receipt_notes
          SET
            status = 'rejected',
            updated_at = NOW()
          WHERE id = ${documentId}
        `;
        break;

      default:
        log.warn({
          module: 'procurement',
          message: `Unknown document type for status update: ${documentType}`,
        });
    }
  } catch (error) {
    log.error({
      module: 'procurement',
      message: 'Failed to update document status after rejection',
      error,
      documentType,
      documentId,
    });
    // Don't throw - rejection is still valid even if document update fails
  }
}
