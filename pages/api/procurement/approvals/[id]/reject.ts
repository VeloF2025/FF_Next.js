import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { notify } from '@/modules/notifications/services';
import { completeApprovalActionItem, createRejectionFollowUp } from '@/lib/action-items/procurementActions';

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

    log.info(
      `Approval rejected: ${request.document_type} ${request.document_id}`,
      { approvalRequestId: id, rejectedBy: userId, reason: reason.trim() },
      'procurement'
    );

    // Complete the approval action item + create follow-up for requester
    completeApprovalActionItem(id as string, userId).catch(err =>
      log.error('Failed to complete rejection action item', { error: err }, 'procurement')
    );
    createRejectionFollowUp({
      approvalRequestId: id as string,
      documentType: request.document_type,
      documentNumber: request.document_number || '',
      requestedByUserId: request.requested_by,
      requestedByName: request.requested_by_name || 'Unknown',
      rejectionReason: reason.trim(),
    }).catch(err =>
      log.error('Failed to create rejection follow-up', { error: err }, 'procurement')
    );

    // UNS: Notify the requester that their request was rejected
    if (request.requested_by) {
      const docLabel = (request.document_type || '').replace(/_/g, ' ');

      notify({
        event_type: 'procurement.rejected',
        title: `${docLabel} rejected`,
        body: `Reason: ${reason.trim()}`,
        action_url: '/procurement/purchase-orders',
        source_module: 'procurement',
        source_id: request.document_id,
        recipient_user_ids: [request.requested_by],
      }).catch((err) => {
        logger.warn('Failed to send rejection notification', { error: err, documentId: request.document_id }, 'procurement-reject');
      });

      // Send inbox message to requester
      try {
        const msgResult = await sql`
          INSERT INTO internal_messages (
            sender_id, subject, body, priority,
            context_module, context_id, context_url
          ) VALUES (
            ${userId}::uuid,
            ${(request.document_number || docLabel) + ' — Rejected'},
            ${'Your ' + docLabel + ' ' + (request.document_number || '') + ' has been rejected by ' + userName + '.\n\nReason: ' + reason.trim()},
            'high', 'procurement', ${request.document_id},
            ${'/procurement/purchase-orders'}
          )
          RETURNING id
        `;
        await sql`
          INSERT INTO internal_message_recipients (message_id, recipient_id)
          VALUES (${msgResult[0]!.id}, ${request.requested_by}::uuid)
          ON CONFLICT (message_id, recipient_id) DO NOTHING
        `;
      } catch (msgErr) {
        log.error('Failed to send rejection inbox message', { error: msgErr }, 'procurement');
      }
    }

    return apiResponse.success(res, updated[0], 'Request rejected');
  } catch (error) {
    log.error('RejectApi', 'Failed to reject request', { error });
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
            status = 'rejected',
            updated_at = NOW()
          WHERE id = ${documentId}
        `;
        break;

      case 'purchase_order':
        await sql`
          UPDATE purchase_orders
          SET
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
        log.warn(`Unknown document type for status update: ${documentType}`, undefined, 'procurement');
    }
  } catch (error) {
    log.error(
      'Failed to update document status after rejection',
      { error, documentType, documentId },
      'procurement'
    );
    // Don't throw - rejection is still valid even if document update fails
  }
}
