/**
 * Procurement → Action Items bridge
 *
 * Creates and resolves action items when procurement approval requests
 * are created, approved, or rejected. Keeps the action_items table
 * in sync with the approval workflow.
 *
 * All functions throw on failure — callers are expected to handle errors
 * with a fire-and-forget `.catch()` so the primary workflow is never blocked.
 * This avoids the double-catch pattern where errors are swallowed internally
 * and then silently ignored by the outer `.catch()`.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const LOGGER = 'ProcurementActions';

interface CreateApprovalActionParams {
  approvalRequestId: string;
  documentType: string;
  documentNumber: string;
  documentAmount: number;
  approverUserId: string;
  approverName: string;
  requestedByName: string;
  projectId?: string;
  dueDate?: string;
}

/**
 * Create an action item for an approver when an approval request is submitted.
 * Called after INSERT into approval_requests.
 *
 * Idempotent: skips INSERT if a non-completed action item already exists for
 * the same approval request and approver, preventing duplicate items when the
 * submission endpoint is retried or called more than once.
 *
 * @throws on database errors — caller should handle via `.catch()`
 */
export async function createApprovalActionItem(params: CreateApprovalActionParams): Promise<void> {
  const {
    approvalRequestId,
    documentType,
    documentNumber,
    documentAmount,
    approverUserId,
    approverName,
    requestedByName,
    projectId,
    dueDate,
  } = params;

  // Idempotency guard: skip if a pending/in-progress item already exists
  const existing = await sql`
    SELECT id FROM action_items
    WHERE source_type = 'procurement'
      AND source_id = ${approvalRequestId}
      AND assigned_to_user_id = ${approverUserId}
      AND status != 'completed'
    LIMIT 1
  `;

  if (existing.length > 0) {
    log.debug('Approval action item already exists, skipping', {
      approvalRequestId,
      approverUserId,
      existingId: (existing[0] as { id: string }).id,
    }, LOGGER);
    return;
  }

  const docLabel = formatDocType(documentType);
  const amountStr = documentAmount ? ` (R${Number(documentAmount).toLocaleString()})` : '';
  const description = `Approve ${docLabel} ${documentNumber}${amountStr} — submitted by ${requestedByName}`;

  await sql`
    INSERT INTO action_items (
      description, assignee_name, assigned_to_user_id,
      source_type, source_id, project_id,
      priority, status, due_date, category
    ) VALUES (
      ${description},
      ${approverName},
      ${approverUserId},
      'procurement',
      ${approvalRequestId},
      ${projectId || null},
      'high',
      'pending',
      ${dueDate || null},
      ${docLabel}
    )
  `;

  log.info('Approval action item created', {
    approvalRequestId,
    approverUserId,
    documentType,
    documentNumber,
  }, LOGGER);
}

/**
 * Mark the approval action item as completed when approved or rejected.
 * Matches on source_type='procurement' AND source_id=approvalRequestId.
 *
 * @throws on database errors — caller should handle via `.catch()`
 */
export async function completeApprovalActionItem(
  approvalRequestId: string,
  resolvedBy?: string
): Promise<void> {
  await sql`
    UPDATE action_items
    SET status = 'completed',
        completed_date = NOW(),
        completed_by = ${resolvedBy || null},
        updated_at = NOW()
    WHERE source_type = 'procurement'
      AND source_id = ${approvalRequestId}
      AND status != 'completed'
  `;

  log.info('Approval action item completed', { approvalRequestId }, LOGGER);
}

/**
 * Create a follow-up action item for the requester after rejection.
 * The requester needs to revise and resubmit.
 *
 * @throws on database errors — caller should handle via `.catch()`
 */
export async function createRejectionFollowUp(params: {
  approvalRequestId: string;
  documentType: string;
  documentNumber: string;
  requestedByUserId: string;
  requestedByName: string;
  rejectionReason?: string;
  projectId?: string;
}): Promise<void> {
  const docLabel = formatDocType(params.documentType);
  const reason = params.rejectionReason ? ` — Reason: ${params.rejectionReason}` : '';
  const description = `Revise and resubmit ${docLabel} ${params.documentNumber} (rejected)${reason}`;

  await sql`
    INSERT INTO action_items (
      description, assignee_name, assigned_to_user_id,
      source_type, source_id, project_id,
      priority, status, category
    ) VALUES (
      ${description},
      ${params.requestedByName},
      ${params.requestedByUserId},
      'procurement',
      ${params.approvalRequestId},
      ${params.projectId || null},
      'high',
      'pending',
      ${docLabel}
    )
  `;

  log.info('Rejection follow-up created', {
    approvalRequestId: params.approvalRequestId,
    requestedByUserId: params.requestedByUserId,
  }, LOGGER);
}

function formatDocType(type: string): string {
  switch (type) {
    case 'purchase_requisition': return 'Purchase Requisition';
    case 'purchase_order': return 'Purchase Order';
    case 'payment_request': return 'Payment Request';
    case 'goods_receipt': return 'Goods Receipt';
    case 'rfq': return 'RFQ';
    case 'boq': return 'BOQ';
    default: return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
