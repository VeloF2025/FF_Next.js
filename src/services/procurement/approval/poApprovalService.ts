/**
 * PO Approval Service
 *
 * Server-side service for managing PO approval workflow with:
 * - Multi-level threshold-based approval
 * - Version tracking on rejection
 * - Quote comparison data for approvers
 * - Integration with approval_requests table
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

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
        LIMIT 1
      `;

      if (result.length === 0) {
        return null;
      }

      const level = result[0]!;
      return {
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
      };
    } catch (error) {
      log.error('Failed to get approval level', { amount, error });
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
          SELECT id, name, email FROM users WHERE id = ${level.approverUserId}
        `;
        approvers = result.map(r => ({ id: r.id, name: r.name, email: r.email }));
      } else if (level.approverType === 'role' && level.approverRole) {
        const result = await sql`
          SELECT id, name, email FROM users WHERE role = ${level.approverRole}
        `;
        approvers = result.map(r => ({ id: r.id, name: r.name, email: r.email }));
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

      // Get appropriate approval level
      const level = await this.getApprovalLevelForAmount(totalAmount);

      if (!level) {
        // No level found - auto-approve (workflow not configured)
        await this.updatePOStatus(poId, 'approved', requestedBy, 'Auto-approved (no workflow configured)');
        return { approvalRequest: null, autoApproved: true };
      }

      // Check for auto-approve
      if (level.autoApprove) {
        await this.updatePOStatus(poId, 'approved', requestedBy, `Auto-approved (${level.name})`);
        return { approvalRequest: null, autoApproved: true };
      }

      // Create approval request
      const dueDate = new Date();
      dueDate.setHours(dueDate.getHours() + 48); // 48 hour deadline

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
          ${level.workflowId},
          ${level.id},
          'purchase_order',
          ${poId},
          ${po.po_number},
          ${totalAmount},
          ${requestedBy},
          ${requestedByName},
          'pending',
          ${dueDate.toISOString()}
        )
        RETURNING id
      `;

      const approvalRequestId = approvalResult[0]!.id;

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
        items: itemsResult.map(item => ({
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

      const allQuotes = quotesResult.map(q => ({
        id: q.id,
        quoteNumber: q.quote_number,
        supplierName: q.supplier_name,
        totalAmount: parseFloat(q.total_amount) || 0,
        isSelected: q.id === po.quote_id,
      }));

      const selectedQuoteData = quotesResult.find(q => q.id === po.quote_id);
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

      const history = historyResult.map(h => ({
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

      return result.map(v => {
        const snapshot = typeof v.snapshot === 'string' ? JSON.parse(v.snapshot) : v.snapshot;
        return {
          version: v.version,
          rejectionReason: v.rejection_reason,
          rejectedBy: v.rejected_by_name,
          rejectedAt: v.rejected_at ? new Date(v.rejected_at) : null,
          totalAmount: snapshot.totalAmount || 0,
        };
      });
    } catch (error) {
      log.error('Failed to get version history', { poId, error });
      throw error;
    }
  }

  /**
   * Check if user can approve a PO
   */
  async canUserApprove(poId: string, userId: string): Promise<boolean> {
    try {
      const poResult = await sql`
        SELECT total_amount, status FROM purchase_orders WHERE id = ${poId}
      `;

      if (poResult.length === 0 || poResult[0]!.status !== 'pending_approval') {
        return false;
      }

      const totalAmount = parseFloat(poResult[0]!.total_amount) || 0;
      const level = await this.getApprovalLevelForAmount(totalAmount);

      if (!level) {
        return false;
      }

      // Check based on approver type
      if (level.approverType === 'user') {
        return level.approverUserId === userId;
      }

      if (level.approverType === 'role' && level.approverRole) {
        const userResult = await sql`
          SELECT role FROM users WHERE id = ${userId}
        `;
        return userResult.length > 0 && userResult[0]!.role === level.approverRole;
      }

      // For other types, allow for now (TODO: implement full check)
      return true;
    } catch (error) {
      log.error('Failed to check approval permission', { poId, userId, error });
      return false;
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
