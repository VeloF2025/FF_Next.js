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
import { userHasPermission } from '@/lib/permissions';
import { notify } from '@/modules/notifications/services';
import { createApprovalActionItem } from '@/lib/action-items/procurementActions';

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
      SELECT id, status, assigned_to, assigned_to_name, parked_by,
             document_type, document_id, document_number, document_amount,
             requested_by, requested_by_name
      FROM approval_requests
      WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Approval request', id);
    }

    const request = existing[0]!;

    // Caller must be the assigned approver, the user who parked it, super_admin,
    // or hold procurement.sourcing edit rights. Anyone else is forbidden.
    const isAssignee = request.assigned_to && String(request.assigned_to) === String(userId);
    const isParker = request.parked_by && String(request.parked_by) === String(userId);
    const isSuperAdmin = authReq.user.role === 'super_admin';
    const hasProcurementEdit = isSuperAdmin
      ? true
      : await userHasPermission(userId, 'procurement.sourcing', 'edit');
    if (!isAssignee && !isParker && !hasProcurementEdit) {
      return apiResponse.forbidden(res, 'You are not authorised to resume this approval request');
    }

    // Atomic transition — guards against double-resume and resume↔approve races.
    const updated = await sql`
      UPDATE approval_requests
      SET
        status = 'pending',
        parked_at = NULL,
        parked_by = NULL,
        parked_by_name = NULL,
        park_reason = NULL,
        updated_at = NOW()
      WHERE id = ${id} AND status = 'on_hold'
      RETURNING id, status, assigned_to, assigned_to_name,
                document_type, document_id, document_number, requested_by
    `;

    if (updated.length === 0) {
      return apiResponse.conflict(
        res,
        `Cannot resume request — its status changed before the action completed (must be 'on_hold')`,
      );
    }

    log.info(
      `Approval resumed: ${request.document_type} ${request.document_id}`,
      { approvalRequestId: id, resumedBy: userId },
      'procurement-resume',
    );

    // Re-create the assignee's action-item (was completed when parked).
    // The helper is idempotent: skips if a non-completed item already exists.
    if (request.assigned_to) {
      createApprovalActionItem({
        approvalRequestId: String(id),
        documentType: String(request.document_type || ''),
        documentNumber: String(request.document_number || ''),
        documentAmount: Number(request.document_amount || 0),
        approverUserId: String(request.assigned_to),
        approverName: String(request.assigned_to_name || ''),
        requestedByName: String(request.requested_by_name || 'Unknown'),
      }).catch((err) =>
        log.error('Failed to re-create resume action item', { error: err }, 'procurement-resume'),
      );
    }

    // Notify the current assignee (back in their queue) and the requester
    // (hold lifted).
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
    log.error('Failed to resume request', { error }, 'procurement-resume');
    return apiResponse.databaseError(res, error, 'Failed to resume request');
  }
}));
