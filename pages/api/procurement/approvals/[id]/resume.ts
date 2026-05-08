/**
 * POST /api/procurement/approvals/[id]/resume
 * Resumes a parked (on_hold) approval request by flipping it back to 'pending'.
 * The original assignee and chain position are preserved.
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

  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Approval request ID is required' });
  }

  try {
    const existing = await sql`
      SELECT id, status, assigned_to, document_type, document_id, document_number, requested_by
      FROM approval_requests
      WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Approval request', id);
    }

    const request = existing[0]!;

    if (request.status !== 'on_hold') {
      return apiResponse.validationError(res, {
        status: `Cannot resume a request that is ${request.status}; only parked requests can be resumed`,
      });
    }

    const updated = await sql`
      UPDATE approval_requests
      SET
        status = 'pending',
        parked_at = NULL,
        parked_by = NULL,
        parked_by_name = NULL,
        park_reason = NULL,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    log.info(
      `Approval resumed: ${request.document_type} ${request.document_id}`,
      { approvalRequestId: id, resumedBy: userId },
      'procurement',
    );

    // Notify the current assignee that the request is back in their queue,
    // and the requester that the hold has been lifted.
    const docLabel = (request.document_type || '').replace(/_/g, ' ');
    const recipients = new Set<string>();
    if (request.assigned_to) recipients.add(String(request.assigned_to));
    if (request.requested_by) recipients.add(String(request.requested_by));

    if (recipients.size > 0) {
      notify({
        event_type: 'procurement.resumed',
        title: `${docLabel} resumed`,
        body: `${userName || 'A user'} resumed this request — it is now pending approval again.`,
        action_url: '/procurement/approvals',
        source_module: 'procurement',
        source_id: request.document_id,
        recipient_user_ids: Array.from(recipients),
      }).catch((err) => {
        log.warn('Failed to send resume notification', { error: err, documentId: request.document_id }, 'procurement-resume');
      });
    }

    return apiResponse.success(res, updated[0], 'Request resumed');
  } catch (error) {
    log.error('Failed to resume request', { error: { error } }, 'ResumeApi');
    return apiResponse.databaseError(res, error, 'Failed to resume request');
  }
}));
