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
import { userHasPermission } from '@/lib/permissions';
import { notify } from '@/modules/notifications/services';
import { completeApprovalActionItem } from '@/lib/action-items/procurementActions';
import { isEligibleApprover } from '@/modules/procurement/approvals/eligibility';

const sql = neon(process.env.DATABASE_URL!);

const MAX_REASON_LENGTH = 2000;

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
  if (reasonRaw.length > MAX_REASON_LENGTH) {
    return apiResponse.validationError(res, {
      reason: `Reason must be ${MAX_REASON_LENGTH} characters or fewer`,
    });
  }
  const reason = reasonRaw.trim() || null;

  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Approval request ID is required' });
  }

  try {
    const existing = await sql`
      SELECT ar.id, ar.status, ar.assigned_to, ar.document_type, ar.document_id,
             ar.document_number, ar.requested_by,
             al.approver_type, al.approver_user_id, al.approver_role
      FROM approval_requests ar
      JOIN approval_workflows aw ON ar.workflow_id = aw.id
      JOIN approval_levels al ON ar.level_id = al.id
      WHERE ar.id = ${id}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Approval request', id);
    }

    const request = existing[0]!;

    // Authz: caller must be the level's eligible approver, the assigned
    // approver, super_admin, or hold the procurement.sourcing edit
    // permission. The asymmetry vs resume.ts — resume also accepts the
    // original parker — is intentional: parking is an active gate, so only
    // the approver-side may decide to hold; resuming includes the parker so
    // they can undo their own pause without needing to be the approver
    // themselves.
    // Requesters cannot park their own request: that would be a workflow-
    // bypass (silently stalling the chain).
    const isAssignee = request.assigned_to && String(request.assigned_to) === String(userId);
    const isSuperAdmin = authReq.user.role === 'super_admin';
    const hasProcurementEdit = isSuperAdmin
      ? true
      : await userHasPermission(userId, 'procurement.sourcing', 'edit');
    const eligible = isEligibleApprover({
      userId,
      userRole: authReq.user.role,
      approverType: request.approver_type,
      approverUserId: request.approver_user_id,
      approverRole: request.approver_role,
      assignedTo: request.assigned_to ?? null,
    });
    if (!eligible && !isAssignee && !hasProcurementEdit) {
      return apiResponse.forbidden(res, 'You are not authorised to park this approval request');
    }

    // Atomic transition — guards the SELECT-then-UPDATE race where two
    // parallel parks (or park + approve) both pass the precheck.
    const updated = await sql`
      UPDATE approval_requests
      SET
        status = 'on_hold',
        parked_at = NOW(),
        parked_by = ${userId},
        parked_by_name = ${userName},
        park_reason = ${reason},
        updated_at = NOW()
      WHERE id = ${id} AND status = 'pending'
      RETURNING id, status, parked_at, parked_by, parked_by_name, park_reason,
                document_type, document_id, document_number, assigned_to, requested_by
    `;

    if (updated.length === 0) {
      return apiResponse.conflict(
        res,
        `Cannot park request — its status changed before the action completed (must be 'pending')`,
      );
    }

    log.info(
      `Approval parked: ${request.document_type} ${request.document_id}`,
      { approvalRequestId: id, parkedBy: userId, hasReason: !!reason },
      'procurement-park',
    );

    // Mirror reject.ts: clear the assignee's action-item so a parked request
    // doesn't sit in their queue while on hold. Resume re-creates it.
    completeApprovalActionItem(id, userId).catch((err) =>
      log.error('Failed to complete park action item', { error: err }, 'procurement-park'),
    );

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
    log.error('Failed to park request', { error }, 'procurement-park');
    return apiResponse.databaseError(res, error, 'Failed to park request');
  }
}));
