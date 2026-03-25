import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logUpdate } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { notify } from '@/modules/notifications/services';
import { createApprovalActionItem } from '@/lib/action-items/procurementActions';

const sql = createLoggedSql(process.env.DATABASE_URL!);

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
  const userName = authReq.user.name || authReq.user.email;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Requisition ID is required');
  }

  try {
    // Check current status
    const [requisition] = await sql`
      SELECT status, estimated_total FROM purchase_requisitions WHERE id = ${id}
    `;

    if (!requisition) {
      return apiResponse.notFound(res, 'Purchase Requisition', id);
    }

    if (requisition.status !== 'draft') {
      return apiResponse.badRequest(res, 'Only draft requisitions can be submitted');
    }

    // Check if requisition has items
    const [itemCount] = await sql`
      SELECT COUNT(*)::int as count FROM purchase_requisition_items WHERE requisition_id = ${id}
    `;

    if (itemCount!.count === 0) {
      return apiResponse.badRequest(res, 'Cannot submit requisition without items');
    }

    // Determine if approval is required based on amount
    const amount = Number(requisition.estimated_total || 0);
    const needsApproval = amount >= 10000; // R10,000 threshold

    // Update status
    const newStatus = needsApproval ? 'pending_approval' : 'approved';

    const [updated] = await sql`
      UPDATE purchase_requisitions
      SET
        status = ${newStatus},
        approved_at = ${needsApproval ? null : new Date().toISOString()},
        approved_by = ${needsApproval ? null : 'auto-approved'}
      WHERE id = ${id}
      RETURNING *
    `;

    // Create approval request if needed
    if (needsApproval) {
      let approvalCreated = false;

      // Find applicable workflow
      const [workflow] = await sql`
        SELECT id FROM approval_workflows
        WHERE workflow_type = 'purchase_requisition'
        AND is_active = true
        LIMIT 1
      `;

      if (workflow) {
        // Find ALL applicable levels based on amount, ordered by level_number
        const levels = await sql`
          SELECT id, level_number FROM approval_levels
          WHERE workflow_id = ${workflow.id}
          AND min_amount <= ${amount}
          AND (max_amount IS NULL OR max_amount >= ${amount})
          ORDER BY level_number ASC
        `;

        if (levels.length > 0) {
          // Create approval requests for ALL levels
          // First level is 'pending', subsequent levels are 'waiting'
          for (let i = 0; i < levels.length; i++) {
            const level = levels[i]!;
            const levelStatus = i === 0 ? 'pending' : 'waiting';
            await sql`
              INSERT INTO approval_requests (
                workflow_id,
                level_id,
                document_type,
                document_id,
                document_number,
                document_amount,
                requested_by,
                requested_by_name,
                status
              ) VALUES (
                ${workflow.id},
                ${level.id},
                'purchase_requisition',
                ${id},
                ${updated!.requisition_number},
                ${amount},
                ${userId || 'system'},
                ${userName || 'Unknown'},
                ${levelStatus}
              )
            `;
          }
          approvalCreated = true;

          // Notify approvers for the FIRST level only (they act first)
          const firstLevel = levels[0]!;
          const approvers = await sql`
            SELECT u.id, COALESCE(u.first_name || ' ' || u.last_name, u.email) as name, u.email
            FROM users u
            JOIN approval_levels al ON al.id = ${firstLevel.id}
            WHERE (
              (al.approver_type = 'user' AND u.id::text = al.approver_user_id::text)
              OR (al.approver_type = 'role' AND u.role = al.approver_role)
            )
          `;

          const approverIds = approvers.map((a: Record<string, unknown>) => a.id as string);

          // Create action items for each approver
          for (const approver of approvers) {
            createApprovalActionItem({
              approvalRequestId: String(id),
              documentType: 'purchase_requisition',
              documentNumber: updated!.requisition_number,
              documentAmount: amount,
              approverUserId: approver.id as string,
              approverName: approver.name as string,
              requestedByName: userName || 'Unknown',
            }).catch(err => log.error('PR action item failed', { error: err }, 'procurement'));
          }

          if (approverIds.length > 0) {
            const formattedAmount = new Intl.NumberFormat('en-ZA', {
              style: 'currency', currency: 'ZAR',
            }).format(amount);

            notify({
              event_type: 'procurement.approval_needed',
              title: `PR ${updated!.requisition_number} requires your approval`,
              body: `${userName} submitted a purchase requisition for ${formattedAmount}`,
              action_url: `/procurement/requisitions/${id}`,
              source_module: 'procurement',
              source_id: id,
              recipient_user_ids: approverIds,
            }).catch(err => {
              log.error('Failed to send PR approval notification', { error: err }, 'procurement');
            });

            // Send inbox message
            const msgResult = await sql`
              INSERT INTO internal_messages (
                sender_id, subject, body, priority,
                context_module, context_id, context_url
              ) VALUES (
                ${userId}::uuid,
                ${'PR ' + updated!.requisition_number + ' — Approval Required'},
                ${'Purchase Requisition ' + updated!.requisition_number + ' for ' + formattedAmount + ' has been submitted for your approval.\n\nSubmitted by: ' + userName},
                'normal', 'procurement', ${id},
                ${'/procurement/requisitions/' + id}
              )
              RETURNING id
            `;

            for (const approverId of approverIds) {
              await sql`
                INSERT INTO internal_message_recipients (message_id, recipient_id)
                VALUES (${msgResult[0]!.id}, ${approverId}::uuid)
                ON CONFLICT (message_id, recipient_id) DO NOTHING
              `;
            }
          }
        }
      }

      // If no workflow/level configured, auto-approve to prevent stuck state
      if (!approvalCreated) {
        log.warn(
          'No approval workflow or level configured for purchase_requisition — auto-approving',
          { requisitionId: id, amount },
          'procurement'
        );
        await sql`
          UPDATE purchase_requisitions
          SET
            status = 'approved',
            approved_at = ${new Date().toISOString()},
            approved_by = 'auto-approved'
          WHERE id = ${id}
        `;
        // Override the returned status
        updated!.status = 'approved';
      }
    }

    logUpdate('purchase_requisition', id, { status: newStatus });

    return apiResponse.success(res, {
      id: updated!.id,
      status: updated!.status,
      message: updated!.status === 'approved'
        ? 'Requisition auto-approved'
        : 'Requisition submitted for approval',
    });
  } catch (error) {
    log.error('SubmitApi', 'Failed to submit requisition', { error });
    return apiResponse.databaseError(res, error, 'Failed to submit requisition');
  }
}));
