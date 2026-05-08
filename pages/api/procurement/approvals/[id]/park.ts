/**
 * POST /api/procurement/approvals/[id]/park
 * Puts a pending approval request on hold without approving or rejecting it.
 * The request keeps its current approver and chain position; it can be resumed
 * later from the Parked tab. Reason is optional.
 */

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
  const reasonRaw = (req.body && typeof req.body.reason === 'string') ? req.body.reason : '';
  const reason = reasonRaw.trim() || null;

  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Approval request ID is required' });
  }

  try {
    const existing = await sql`
      SELECT id, status, document_type, document_id, document_number, requested_by
      FROM approval_requests
      WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Approval request', id);
    }

    const request = existing[0]!;

    if (request.status !== 'pending') {
      return apiResponse.validationError(res, {
        status: `Cannot park a request that is ${request.status}; only pending requests can be parked`,
      });
    }

    const updated = await sql`
      UPDATE approval_requests
      SET
        status = 'on_hold',
        parked_at = NOW(),
        parked_by = ${userId || 'system'},
        parked_by_name = ${userName || 'System User'},
        park_reason = ${reason},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    log.info(
      `Approval parked: ${request.document_type} ${request.document_id}`,
      { approvalRequestId: id, parkedBy: userId, reason },
      'procurement',
    );

    // Notify the requester so they know their request is on hold.
    if (request.requested_by) {
      const docLabel = (request.document_type || '').replace(/_/g, ' ');
      notify({
        event_type: 'procurement.parked',
        title: `${docLabel} put on hold`,
        body: reason ? `Reason: ${reason}` : 'Your request has been parked and will be reviewed later.',
        action_url: '/procurement/approvals',
        source_module: 'procurement',
        source_id: request.document_id,
        recipient_user_ids: [request.requested_by],
      }).catch((err) => {
        log.warn('Failed to send park notification', { error: err, documentId: request.document_id }, 'procurement-park');
      });
    }

    return apiResponse.success(res, updated[0], 'Request parked');
  } catch (error) {
    log.error('Failed to park request', { error: { error } }, 'ParkApi');
    return apiResponse.databaseError(res, error, 'Failed to park request');
  }
}));
