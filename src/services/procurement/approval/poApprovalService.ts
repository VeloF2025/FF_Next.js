/**
 * PO Approval Service
 *
 * Server-side service for managing PO approval workflow with:
 * - Multi-level threshold-based approval
 * - Version tracking on rejection
 * - Quote comparison data for approvers
 * - Integration with approval_requests table
 */

import { neon, type NeonQueryFunction } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { postPurchaseOrderToGL } from '@/modules/accounting/services/glCrossModuleHooks';
import { notify } from '@/modules/notifications/services';
import {
  createApprovalActionItem,
  completeApprovalActionItem,
  createRejectionFollowUp,
} from '@/lib/action-items/procurementActions';

const sql: NeonQueryFunction<false> = neon(process.env.DATABASE_URL!);

// Row types for SQL query results
interface ApprovalLevelRow {
  id: string;
  workflow_id: string;
  level_number: number;
  name: string;
  min_amount: string;
  max_amount: string | null;
  approver_type: 'user' | 'role' | 'department_head' | 'project_manager' | 'any_of_group';
  approver_user_id: string | null;
  approver_role: string | null;
  approver_group_ids: string[] | null;
  auto_approve: boolean;
  can_delegate: boolean;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
}

interface POItemRow {
  id: string;
  item_description: string;
  quantity_ordered: string;
  unit_price: string;
  total_price: string;
}

interface QuoteRow {
  id: string;
  quote_number: string;
  supplier_name: string;
  total_amount: string;
  valid_until: string | null;
  delivery_days: number | null;
  payment_terms: string | null;
}

interface ApprovalHistoryRow {
  action: string;
  performed_by_name: string | null;
  performed_at: string;
  notes: string | null;
}

interface VersionRow {
  version: number;
  rejection_reason: string | null;
  rejected_by_name: string | null;
  rejected_at: string | null;
  snapshot: string | Record<string, unknown>;
}

// Types
export interface ApprovalLevel {
  id: string;
  workflowId: string;
  levelNumber: number;
  name: string;
  minAmount: number;
  maxAmount: number | null;
  approverType: 'user' | 'role' | 'department_head' | 'project_manager' | 'any_of_group';
  approverUserId: string | null;
  approverRole: string | null;
  approverGroupIds: string[] | null;
  autoApprove: boolean;
  canDelegate: boolean;
}

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  levelId: string;
  documentType: string;
  documentId: string;
  documentNumber: string;
  documentAmount: number;
  requestedBy: string;
  requestedByName: string;
  status: 'pending' | 'approved' | 'rejected' | 'escalated' | 'skipped' | 'cancelled';
  assignedTo: string | null;
  respondedBy: string | null;
  responseNotes: string | null;
  dueDate: Date | null;
  createdAt: Date;
}

export interface POVersionSnapshot {
  id: string;
  poNumber: string;
  status: string;
  supplierId: number;
  totalAmount: number;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  deliveryAddress: string;
  paymentTerms: string;
  notes: string | null;
}

export interface QuoteComparison {
  rfqId: string | null;
  rfqNumber: string | null;
  rfqTitle: string | null;
  selectedQuoteId: string | null;
  selectedQuote: {
    id: string;
    quoteNumber: string;
    supplierName: string;
    totalAmount: number;
    validUntil: string | null;
    deliveryDays: number | null;
    paymentTerms: string | null;
  } | null;
  allQuotes: Array<{
    id: string;
    quoteNumber: string;
    supplierName: string;
    totalAmount: number;
    isSelected: boolean;
  }>;
}

class POApprovalService {
  /**
   * Get the appropriate approval level for a PO amount
   */
  async getApprovalLevelForAmount(amount: number): Promise<ApprovalLevel | null> {
    const levels = await this.getApprovalLevelsForAmount(amount);
    return levels.length > 0 ? levels[0]! : null;
  }

  /**
   * Get ALL applicable approval levels for a PO amount (for sequential chain)
   */
  async getApprovalLevelsForAmount(amount: number): Promise<ApprovalLevel[]> {
    try {
      const result = await sql`
        SELECT
          al.id,
          al.workflow_id,
          al.level_number,
          al.name,
          al.min_amount,
          al.max_amount,
          al.approver_type,
          al.approver_user_id,
          al.approver_role,
          al.approver_group_ids,
          al.auto_approve,
          al.can_delegate
        FROM approval_levels al
        JOIN approval_workflows aw ON al.workflow_id = aw.id
        WHERE aw.workflow_type = 'purchase_order'
          AND aw.is_active = true
          AND al.min_amount <= ${amount}
          AND (al.max_amount IS NULL OR al.max_amount > ${amount})
        ORDER BY al.level_number ASC
      `;

      return (result as ApprovalLevelRow[]).map((level) => ({
        id: level.id,
        workflowId: level.workflow_id,
        levelNumber: level.level_number,
        name: level.name,
        minAmount: parseFloat(level.min_amount) || 0,
        maxAmount: level.max_amount ? parseFloat(level.max_amount) : null,
        approverType: level.approver_type,
        approverUserId: level.approver_user_id,
        approverRole: level.approver_role,
        approverGroupIds: level.approver_group_ids,
        autoApprove: level.auto_approve,
        canDelegate: level.can_delegate,
      }));
    } catch (error) {
      log.error('Failed to get approval levels', { amount, error });
      throw error;
    }
  }

  /**
   * Get approvers for a specific level
   */
  async getApproversForLevel(level: ApprovalLevel): Promise<Array<{ id: string; name: string; email: string }>> {
    try {
      let approvers: Array<{ id: string; name: string; email: string }> = [];

      if (level.approverType === 'user' && level.approverUserId) {
        const result = await sql`
          SELECT id, COALESCE(first_name || ' ' || last_name, email) as name, email
          FROM users WHERE id = ${level.approverUserId}
        `;
        approvers = (result as UserRow[]).map((r) => ({ id: r.id, name: r.name, email: r.email }));
      } else if (level.approverType === 'role' && level.approverRole) {
        const result = await sql`
          SELECT id, COALESCE(first_name || ' ' || last_name, email) as name, email
          FROM users WHERE role = ${level.approverRole}
        `;
        approvers = (result as UserRow[]).map((r) => ({ id: r.id, name: r.name, email: r.email }));
      }

      return approvers;
    } catch (error) {
      log.error('Failed to get approvers for level', { levelId: level.id, error });
      throw error;
    }
  }

  /**
   * Submit a PO for approval
   */
  async submitForApproval(
    poId: string,
    requestedBy: string,
    requestedByName: string
  ): Promise<{ approvalRequest: ApprovalRequest | null; autoApproved: boolean }> {
    try {
      // Get PO details
      const poResult = await sql`
        SELECT
          id, po_number, status, total_amount, version
        FROM purchase_orders
        WHERE id = ${poId}
      `;

      if (poResult.length === 0) {
        throw new Error('Purchase order not found');
      }

      const po = poResult[0]!;

      if (po.status !== 'draft') {
        throw new Error('Only draft POs can be submitted for approval');
      }

      const totalAmount = parseFloat(po.total_amount) || 0;

      // Get ALL applicable approval levels
      const levels = await this.getApprovalLevelsForAmount(totalAmount);

      if (levels.length === 0) {
        // No level found - auto-approve (workflow not configured)
        await this.updatePOStatus(poId, 'approved', requestedBy, 'Auto-approved (no workflow configured)');
        return { approvalRequest: null, autoApproved: true };
      }

      // Filter out auto-approve levels at the front of the chain
      const firstNonAutoLevel = levels.findIndex(l => !l.autoApprove);
      if (firstNonAutoLevel === -1) {
        // All levels are auto-approve
        await this.updatePOStatus(poId, 'approved', requestedBy, `Auto-approved (${levels[0]!.name})`);
        return { approvalRequest: null, autoApproved: true };
      }

      const level = levels[firstNonAutoLevel]!;

      // Create approval requests for ALL non-auto levels
      // First non-auto level is 'pending', subsequent are 'waiting'
      const dueDate = new Date();
      dueDate.setHours(dueDate.getHours() + 48);

      let approvalRequestId: string = '';
      for (let i = firstNonAutoLevel; i < levels.length; i++) {
        const lvl = levels[i]!;
        if (lvl.autoApprove) continue;
        const lvlStatus = i === firstNonAutoLevel ? 'pending' : 'waiting';
        const approvalResult = await sql`
          INSERT INTO approval_requests (
            workflow_id,
            level_id,
            document_type,
            document_id,
            document_number,
            document_amount,
            requested_by,
            requested_by_name,
            status,
            due_date
          ) VALUES (
            ${lvl.workflowId},
            ${lvl.id},
            'purchase_order',
            ${poId},
            ${po.po_number},
            ${totalAmount},
            ${requestedBy},
            ${requestedByName},
            ${lvlStatus},
            ${dueDate.toISOString()}
          )
          RETURNING id
        `;
        if (i === firstNonAutoLevel) {
          approvalRequestId = approvalResult[0]!.id;
        }
      }

      // Update PO status and link approval request
      await sql`
        UPDATE purchase_orders
        SET
          status = 'pending_approval',
          current_approval_request_id = ${approvalRequestId},
          updated_at = NOW()
        WHERE id = ${poId}
      `;

      // Add history entry
      await sql`
        INSERT INTO purchase_order_history (
          purchase_order_id, action, notes, created_by, created_at
        ) VALUES (
          ${poId}, 'submitted', ${`Submitted for ${level.name}`}, ${requestedBy}, NOW()
        )
      `;

      log.info('PO submitted for approval', {
        poId,
        approvalRequestId,
        level: level.name,
        amount: totalAmount,
      });

      // Create action items for approvers
      const approvers = await this.getApproversForLevel(level);
      const approverIds = approvers.map(a => a.id);

      for (const approver of approvers) {
        createApprovalActionItem({
          approvalRequestId,
          documentType: 'purchase_order',
          documentNumber: po.po_number,
          documentAmount: totalAmount,
          approverUserId: approver.id,
          approverName: approver.name,
          requestedByName,
          dueDate: dueDate.toISOString(),
        }).catch(err => log.error('PO action item failed', { error: err }, 'procurement'));
      }

      // Notify approvers via bell notification + inbox message
      if (approverIds.length > 0) {
        const formattedAmount = new Intl.NumberFormat('en-ZA', {
          style: 'currency', currency: 'ZAR',
        }).format(totalAmount);

        // Bell notification
        notify({
          event_type: 'procurement.approval_needed',
          title: `PO ${po.po_number} requires your approval`,
          body: `${requestedByName} submitted a purchase order for ${formattedAmount}`,
          action_url: `/procurement/purchase-orders/${poId}`,
          source_module: 'procurement',
          source_id: poId,
          recipient_user_ids: approverIds,
        }).catch(err => {
          log.error('Failed to send approval notification', { error: err }, 'procurement');
        });

        // Inbox message via internal_messages
        this.sendApprovalInboxMessage(
          requestedBy,
          approverIds,
          `PO ${po.po_number} — Approval Required`,
          `Purchase Order ${po.po_number} for ${formattedAmount} has been submitted for your approval.\n\nLevel: ${level.name}\nSubmitted by: ${requestedByName}`,
          'procurement',
          poId,
          `/procurement/purchase-orders/${poId}`
        ).catch(err => {
          log.error('Failed to send approval inbox message', { error: err }, 'procurement');
        });
      }

      // Return approval request
      const approvalRequest: ApprovalRequest = {
        id: approvalRequestId,
        workflowId: level.workflowId,
        levelId: level.id,
        documentType: 'purchase_order',
        documentId: poId,
        documentNumber: po.po_number,
        documentAmount: totalAmount,
        requestedBy,
        requestedByName,
        status: 'pending',
        assignedTo: null,
        respondedBy: null,
        responseNotes: null,
        dueDate,
        createdAt: new Date(),
      };

      return { approvalRequest, autoApproved: false };
    } catch (error) {
      log.error('Failed to submit PO for approval', { poId, error });
      throw error;
    }
  }

  /**
   * Approve a PO
   */
  async approvePO(
    poId: string,
    approverId: string,
    approverName: string,
    notes?: string
  ): Promise<void> {
    try {
      // Get current PO and approval request
      const poResult = await sql`
        SELECT
          po.id, po.po_number, po.status, po.current_approval_request_id, po.total_amount
        FROM purchase_orders po
        WHERE po.id = ${poId}
      `;

      if (poResult.length === 0) {
        throw new Error('Purchase order not found');
      }

      const po = poResult[0]!;

      if (po.status !== 'pending_approval') {
        throw new Error('PO is not pending approval');
      }

      // Validate approver has permission (TODO: implement role check)
      // For now, any authenticated user can approve

      // Update approval request
      if (po.current_approval_request_id) {
        await sql`
          UPDATE approval_requests
          SET
            status = 'approved',
            responded_by = ${approverId},
            responded_by_name = ${approverName},
            responded_at = NOW(),
            response_notes = ${notes || null},
            updated_at = NOW()
          WHERE id = ${po.current_approval_request_id}
        `;
      }

      // Update PO status
      await sql`
        UPDATE purchase_orders
        SET
          status = 'approved',
          approved_by = ${approverName},
          approved_at = NOW(),
          updated_at = NOW()
        WHERE id = ${poId}
      `;

      // Add history entry
      await sql`
        INSERT INTO purchase_order_history (
          purchase_order_id, action, notes, created_by, created_at
        ) VALUES (
          ${poId}, 'approved', ${notes || 'Approved'}, ${approverId}, NOW()
        )
      `;

      // Post commitment to GL (non-blocking)
      postPurchaseOrderToGL(poId, approverId).catch(err => {
        log.warn('Failed to post PO to GL (non-blocking)', { poId, approverId, error: err });
      });

      // Complete the approval action item
      if (po.current_approval_request_id) {
        completeApprovalActionItem(po.current_approval_request_id, approverId).catch(err =>
          log.warn('Failed to complete PO approval action item', { error: err }, 'procurement')
        );
      }

      // Notify requester via bell + inbox
      const approvalRequest = po.current_approval_request_id
        ? (await sql`SELECT requested_by, requested_by_name FROM approval_requests WHERE id = ${po.current_approval_request_id}`)[0]
        : null;

      if (approvalRequest?.requested_by) {
        notify({
          event_type: 'procurement.approved',
          title: `PO ${po.po_number} approved`,
          body: notes ? `Notes: ${notes}` : `Approved by ${approverName}`,
          action_url: `/procurement/purchase-orders/${poId}`,
          source_module: 'procurement',
          source_id: poId,
          recipient_user_ids: [approvalRequest.requested_by],
        }).catch(err => {
          log.warn('Failed to send approval notification (non-blocking)', {
            poId,
            recipient: approvalRequest.requested_by,
            error: err,
          });
        });

        this.sendApprovalInboxMessage(
          approverId,
          [approvalRequest.requested_by],
          `PO ${po.po_number} — Approved`,
          `Your Purchase Order ${po.po_number} has been approved by ${approverName}.${notes ? `\n\nNotes: ${notes}` : ''}`,
          'procurement',
          poId,
          `/procurement/purchase-orders/${poId}`
        ).catch(err => {
          log.warn('Failed to send approval inbox message (non-blocking)', {
            poId,
            recipient: approvalRequest.requested_by,
            error: err,
          });
        });
      }

      log.info('PO approved', { poId, approverId, approverName });
    } catch (error) {
      log.error('Failed to approve PO', { poId, approverId, error });
      throw error;
    }
  }

  /**
   * Reject a PO - creates new version
   */
  async rejectPO(
    poId: string,
    rejecterId: string,
    rejecterName: string,
    reason: string
  ): Promise<{ newVersion: number }> {
    try {
      if (!reason || reason.trim().length === 0) {
        throw new Error('Rejection reason is required');
      }

      // Get current PO
      const poResult = await sql`
        SELECT
          po.*,
          COALESCE(s.company_name, s.name) as supplier_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = ${poId}
      `;

      if (poResult.length === 0) {
        throw new Error('Purchase order not found');
      }

      const po = poResult[0]!;

      if (po.status !== 'pending_approval') {
        throw new Error('PO is not pending approval');
      }

      const currentVersion = po.version || 1;
      const newVersion = currentVersion + 1;

      // Get items for snapshot
      const itemsResult = await sql`
        SELECT id, item_description, quantity_ordered, unit_price, total_price
        FROM purchase_order_items
        WHERE purchase_order_id = ${poId}
      `;

      // Create version snapshot
      const snapshot: POVersionSnapshot = {
        id: po.id,
        poNumber: po.po_number,
        status: po.status,
        supplierId: po.supplier_id,
        totalAmount: parseFloat(po.total_amount) || 0,
        items: (itemsResult as POItemRow[]).map((item) => ({
          id: item.id,
          description: item.item_description,
          quantity: parseFloat(item.quantity_ordered) || 0,
          unitPrice: parseFloat(item.unit_price) || 0,
          total: parseFloat(item.total_price) || 0,
        })),
        deliveryAddress: po.delivery_address,
        paymentTerms: po.payment_terms,
        notes: po.internal_notes,
      };

      // Save version history
      await sql`
        INSERT INTO purchase_order_versions (
          po_id,
          version,
          snapshot,
          rejection_reason,
          rejected_by,
          rejected_by_name,
          rejected_at
        ) VALUES (
          ${poId},
          ${currentVersion},
          ${JSON.stringify(snapshot)},
          ${reason},
          ${rejecterId},
          ${rejecterName},
          NOW()
        )
      `;

      // Update approval request
      if (po.current_approval_request_id) {
        await sql`
          UPDATE approval_requests
          SET
            status = 'rejected',
            responded_by = ${rejecterId},
            responded_by_name = ${rejecterName},
            responded_at = NOW(),
            response_notes = ${reason},
            updated_at = NOW()
          WHERE id = ${po.current_approval_request_id}
        `;
      }

      // Update PO - back to draft with new version
      await sql`
        UPDATE purchase_orders
        SET
          status = 'draft',
          version = ${newVersion},
          current_approval_request_id = NULL,
          updated_at = NOW()
        WHERE id = ${poId}
      `;

      // Add history entry
      await sql`
        INSERT INTO purchase_order_history (
          purchase_order_id, action, notes, created_by, created_at
        ) VALUES (
          ${poId}, 'rejected', ${`Rejected (v${currentVersion}): ${reason}`}, ${rejecterId}, NOW()
        )
      `;

      // Complete approval action item + create follow-up for requester
      if (po.current_approval_request_id) {
        completeApprovalActionItem(po.current_approval_request_id, rejecterId).catch(err =>
          log.warn('Failed to complete PO rejection action item', { error: err }, 'procurement')
        );
      }

      // Notify requester via bell + inbox
      const approvalRequest = po.current_approval_request_id
        ? (await sql`SELECT requested_by, requested_by_name FROM approval_requests WHERE id = ${po.current_approval_request_id}`)[0]
        : null;

      if (approvalRequest?.requested_by) {
        // Guard: only create follow-up when we have a real approval request ID.
        // po.current_approval_request_id is cleared to NULL before this block,
        // so we reference the variable captured before the UPDATE above.
        if (po.current_approval_request_id) {
          createRejectionFollowUp({
            approvalRequestId: po.current_approval_request_id,
            documentType: 'purchase_order',
            documentNumber: po.po_number,
            requestedByUserId: approvalRequest.requested_by,
            requestedByName: approvalRequest.requested_by_name || 'Unknown',
            rejectionReason: reason,
          }).catch(err => log.warn('PO rejection follow-up failed', { error: err }, 'procurement'));
        } else {
          log.warn('Skipping rejection follow-up: no approval_request_id on PO', { poId }, 'procurement');
        }

        notify({
          event_type: 'procurement.rejected',
          title: `PO ${po.po_number} rejected`,
          body: `Reason: ${reason}`,
          action_url: `/procurement/purchase-orders/${poId}`,
          source_module: 'procurement',
          source_id: poId,
          recipient_user_ids: [approvalRequest.requested_by],
        }).catch(err => {
          log.warn('Failed to send rejection notification (non-blocking)', {
            poId,
            recipient: approvalRequest.requested_by,
            error: err,
          });
        });

        this.sendApprovalInboxMessage(
          rejecterId,
          [approvalRequest.requested_by],
          `PO ${po.po_number} — Rejected (v${currentVersion})`,
          `Your Purchase Order ${po.po_number} has been rejected by ${rejecterName}.\n\nReason: ${reason}\n\nThe PO has been reverted to draft (version ${newVersion}) for revision.`,
          'procurement',
          poId,
          `/procurement/purchase-orders/${poId}`
        ).catch(err => {
          log.warn('Failed to send rejection inbox message (non-blocking)', {
            poId,
            recipient: approvalRequest.requested_by,
            error: err,
          });
        });
      }

      log.info('PO rejected', {
        poId,
        rejecterId,
        reason,
        oldVersion: currentVersion,
        newVersion,
      });

      return { newVersion };
    } catch (error) {
      log.error('Failed to reject PO', { poId, rejecterId, error });
      throw error;
    }
  }

  /**
   * Get quote comparison data for approvers
   */
  async getQuoteComparisonForApproval(poId: string): Promise<QuoteComparison> {
    try {
      // Get PO with linked RFQ/quote
      const poResult = await sql`
        SELECT
          po.rfq_id,
          po.quote_id,
          r.rfq_number,
          r.title as rfq_title
        FROM purchase_orders po
        LEFT JOIN rfqs r ON po.rfq_id = r.id
        WHERE po.id = ${poId}
      `;

      if (poResult.length === 0) {
        return {
          rfqId: null,
          rfqNumber: null,
          rfqTitle: null,
          selectedQuoteId: null,
          selectedQuote: null,
          allQuotes: [],
        };
      }

      const po = poResult[0]!;

      if (!po.rfq_id) {
        return {
          rfqId: null,
          rfqNumber: null,
          rfqTitle: null,
          selectedQuoteId: po.quote_id,
          selectedQuote: null,
          allQuotes: [],
        };
      }

      // Get all quotes for this RFQ
      const quotesResult = await sql`
        SELECT
          q.id,
          q.quote_number,
          COALESCE(s.company_name, s.name) as supplier_name,
          q.total_amount,
          q.valid_until,
          q.delivery_days,
          q.payment_terms
        FROM quotes q
        JOIN suppliers s ON q.supplier_id = s.id
        WHERE q.rfq_id = ${po.rfq_id}
        ORDER BY q.total_amount ASC
      `;

      const allQuotes = (quotesResult as QuoteRow[]).map((q) => ({
        id: q.id,
        quoteNumber: q.quote_number,
        supplierName: q.supplier_name,
        totalAmount: parseFloat(q.total_amount) || 0,
        isSelected: q.id === po.quote_id,
      }));

      const selectedQuoteData = (quotesResult as QuoteRow[]).find((q) => q.id === po.quote_id);
      const selectedQuote = selectedQuoteData
        ? {
            id: selectedQuoteData.id,
            quoteNumber: selectedQuoteData.quote_number,
            supplierName: selectedQuoteData.supplier_name,
            totalAmount: parseFloat(selectedQuoteData.total_amount) || 0,
            validUntil: selectedQuoteData.valid_until,
            deliveryDays: selectedQuoteData.delivery_days,
            paymentTerms: selectedQuoteData.payment_terms,
          }
        : null;

      return {
        rfqId: po.rfq_id,
        rfqNumber: po.rfq_number,
        rfqTitle: po.rfq_title,
        selectedQuoteId: po.quote_id,
        selectedQuote,
        allQuotes,
      };
    } catch (error) {
      log.error('Failed to get quote comparison', { poId, error });
      throw error;
    }
  }

  /**
   * Get approval status for a PO
   */
  async getApprovalStatus(poId: string): Promise<{
    status: string;
    level: ApprovalLevel | null;
    request: ApprovalRequest | null;
    history: Array<{ action: string; by: string; at: Date; notes: string | null }>;
  }> {
    try {
      const poResult = await sql`
        SELECT status, current_approval_request_id, total_amount
        FROM purchase_orders
        WHERE id = ${poId}
      `;

      if (poResult.length === 0) {
        throw new Error('Purchase order not found');
      }

      const po = poResult[0]!;
      const totalAmount = parseFloat(po.total_amount) || 0;

      // Get level
      const level = await this.getApprovalLevelForAmount(totalAmount);

      // Get current approval request if exists
      let request: ApprovalRequest | null = null;
      if (po.current_approval_request_id) {
        const requestResult = await sql`
          SELECT * FROM approval_requests WHERE id = ${po.current_approval_request_id}
        `;
        if (requestResult.length > 0) {
          const r = requestResult[0]!;
          request = {
            id: r.id,
            workflowId: r.workflow_id,
            levelId: r.level_id,
            documentType: r.document_type,
            documentId: r.document_id,
            documentNumber: r.document_number,
            documentAmount: parseFloat(r.document_amount) || 0,
            requestedBy: r.requested_by,
            requestedByName: r.requested_by_name,
            status: r.status,
            assignedTo: r.assigned_to,
            respondedBy: r.responded_by,
            responseNotes: r.response_notes,
            dueDate: r.due_date ? new Date(r.due_date) : null,
            createdAt: new Date(r.created_at),
          };
        }
      }

      // Get approval history
      const historyResult = await sql`
        SELECT action, performed_by_name, performed_at, notes
        FROM approval_history
        WHERE approval_request_id IN (
          SELECT id FROM approval_requests WHERE document_id = ${poId}
        )
        ORDER BY performed_at DESC
      `;

      const history = (historyResult as ApprovalHistoryRow[]).map((h) => ({
        action: h.action,
        by: h.performed_by_name || 'Unknown',
        at: new Date(h.performed_at),
        notes: h.notes,
      }));

      return {
        status: po.status,
        level,
        request,
        history,
      };
    } catch (error) {
      log.error('Failed to get approval status', { poId, error });
      throw error;
    }
  }

  /**
   * Get version history for a PO
   */
  async getVersionHistory(poId: string): Promise<Array<{
    version: number;
    rejectionReason: string | null;
    rejectedBy: string | null;
    rejectedAt: Date | null;
    totalAmount: number;
  }>> {
    try {
      const result = await sql`
        SELECT
          version,
          rejection_reason,
          rejected_by_name,
          rejected_at,
          snapshot
        FROM purchase_order_versions
        WHERE po_id = ${poId}
        ORDER BY version DESC
      `;

      return (result as VersionRow[]).map((v) => {
        const snapshot = typeof v.snapshot === 'string'
          ? (JSON.parse(v.snapshot) as Record<string, unknown>)
          : v.snapshot;
        return {
          version: v.version,
          rejectionReason: v.rejection_reason,
          rejectedBy: v.rejected_by_name,
          rejectedAt: v.rejected_at ? new Date(v.rejected_at) : null,
          totalAmount: (snapshot as { totalAmount?: number }).totalAmount || 0,
        };
      });
    } catch (error) {
      log.error('Failed to get version history', { poId, error });
      throw error;
    }
  }

  /**
   * Check if user can approve a PO
   *
   * Approval check order:
   * 1. super_admin and admin can always approve
   * 2. If level has approver_user_id set, check specific user
   * 3. If level has approver_role set, check user's role
   * 4. Otherwise deny
   */
  async canUserApprove(poId: string, userId: string): Promise<boolean> {
    try {
      const poResult = await sql`
        SELECT total_amount, status FROM purchase_orders WHERE id = ${poId}
      `;

      if (poResult.length === 0 || poResult[0]!.status !== 'pending_approval') {
        return false;
      }

      // Get user role
      const userResult = await sql`
        SELECT role FROM users WHERE id = ${userId}
      `;

      if (userResult.length === 0) return false;

      const userRole = userResult[0]!.role;

      // Super admin and admin can always approve
      if (userRole === 'super_admin' || userRole === 'admin') {
        return true;
      }

      const totalAmount = parseFloat(poResult[0]!.total_amount) || 0;
      const level = await this.getApprovalLevelForAmount(totalAmount);

      if (!level) {
        return false;
      }

      // Check specific user assignment first
      if (level.approverType === 'user' && level.approverUserId) {
        return level.approverUserId === userId;
      }

      // Check role-based assignment
      if (level.approverType === 'role' && level.approverRole) {
        return userRole === level.approverRole;
      }

      return false;
    } catch (error) {
      log.error('Failed to check approval permission', { poId, userId, error });
      return false;
    }
  }

  /**
   * Send an internal inbox message to recipients (Comms Hub)
   */
  private async sendApprovalInboxMessage(
    senderId: string,
    recipientIds: string[],
    subject: string,
    body: string,
    contextModule: string,
    contextId: string,
    contextUrl: string
  ): Promise<void> {
    try {
      const messageResult = await sql`
        INSERT INTO internal_messages (
          sender_id, subject, body, priority,
          context_module, context_id, context_url
        ) VALUES (
          ${senderId}::uuid, ${subject}, ${body}, 'normal',
          ${contextModule}, ${contextId}, ${contextUrl}
        )
        RETURNING id
      `;

      const messageId = messageResult[0]!.id;

      for (const recipientId of recipientIds) {
        await sql`
          INSERT INTO internal_message_recipients (message_id, recipient_id)
          VALUES (${messageId}, ${recipientId}::uuid)
          ON CONFLICT (message_id, recipient_id) DO NOTHING
        `;
      }
    } catch (error) {
      log.error('Failed to send approval inbox message', { error, subject }, 'procurement');
    }
  }

  /**
   * Helper to update PO status
   */
  private async updatePOStatus(
    poId: string,
    status: string,
    userId: string,
    notes?: string
  ): Promise<void> {
    await sql`
      UPDATE purchase_orders
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${poId}
    `;

    await sql`
      INSERT INTO purchase_order_history (
        purchase_order_id, action, notes, created_by, created_at
      ) VALUES (
        ${poId}, ${status}, ${notes || null}, ${userId}, NOW()
      )
    `;
  }
}

export const poApprovalService = new POApprovalService();
export default poApprovalService;
