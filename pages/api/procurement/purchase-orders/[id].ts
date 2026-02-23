// WORKING: Purchase Order Detail API - GET detail, PATCH status, DELETE
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, AuthenticatedRequest } from '@/lib/auth';
import { poApprovalService } from '@/services/procurement/approval';
import { createAuditLog } from '@/services/procurement/auditService';

const sql = neon(process.env.DATABASE_URL!);

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Purchase order ID is required');
  }

  // Validate UUID format
  if (!UUID_REGEX.test(id)) {
    return apiResponse.notFound(res, 'Purchase order', id);
  }

  if (req.method === 'GET') {
    return handleGet(req, res, id);
  } else if (req.method === 'PATCH') {
    return handlePatch(req, res, id);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res, id);
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PATCH', 'DELETE']);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    // Fetch PO with supplier and project info
    const poResult = await sql`
      SELECT
        po.id,
        po.po_number,
        po.status,
        po.supplier_id,
        COALESCE(s.company_name, s.name) as supplier_name,
        s.contact_email as supplier_email,
        s.contact_phone as supplier_phone,
        po.project_id,
        p.project_name,
        po.delivery_address,
        po.order_date,
        po.expected_delivery_date,
        po.payment_terms,
        po.currency,
        po.tax_rate,
        po.subtotal,
        po.tax_amount,
        po.total_amount,
        po.internal_notes,
        po.supplier_notes,
        po.created_by,
        po.created_at,
        po.updated_at,
        po.version,
        po.current_approval_request_id,
        po.approved_by,
        po.approved_at,
        po.odoo_po_id,
        po.supplier_reference,
        po.quote_number,
        po.quote_attachment_url,
        po.quote_attachment_name,
        po.department
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN projects p ON po.project_id = p.id
      WHERE po.id = ${id}
    `;

    if (poResult.length === 0) {
      return apiResponse.notFound(res, 'Purchase order', id);
    }

    const po = poResult[0]!;

    // Fetch line items
    const itemsResult = await sql`
      SELECT
        id,
        item_code,
        item_description,
        quantity_ordered,
        quantity_received,
        uom,
        unit_price,
        total_price,
        notes
      FROM purchase_order_items
      WHERE purchase_order_id = ${id}
      ORDER BY created_at
    `;

    // Map items with calculated pending quantity
    const items = itemsResult.map((item, index) => {
      const qtyOrdered = parseFloat(item.quantity_ordered) || 0;
      const qtyReceived = parseFloat(item.quantity_received) || 0;
      return {
        id: item.id,
        lineNumber: index + 1,
        description: item.item_description,
        itemCode: item.item_code,
        quantityOrdered: qtyOrdered,
        quantityReceived: qtyReceived,
        quantityPending: Math.max(0, qtyOrdered - qtyReceived),
        unitOfMeasure: item.uom,
        unitPrice: parseFloat(item.unit_price) || 0,
        lineTotal: parseFloat(item.total_price) || 0,
        notes: item.notes,
      };
    });

    // Fetch history from purchase_order_history
    const historyResult = await sql`
      SELECT id, action, notes, created_by, created_at
      FROM purchase_order_history
      WHERE purchase_order_id = ${id}
      ORDER BY created_at DESC
    `;

    // Fetch version history if version > 1
    const versionHistory = po.version > 1
      ? await poApprovalService.getVersionHistory(id)
      : [];

    // Get quote comparison if RFQ linked
    let quoteComparison = null;
    try {
      quoteComparison = await poApprovalService.getQuoteComparisonForApproval(id);
    } catch {
      // Quote comparison is optional
    }

    const purchaseOrder = {
      id: po.id,
      poNumber: po.po_number,
      status: po.status,
      supplierId: po.supplier_id,
      supplierName: po.supplier_name || 'Unknown Supplier',
      supplierEmail: po.supplier_email,
      supplierPhone: po.supplier_phone,
      projectId: po.project_id,
      projectName: po.project_name,
      deliveryAddress: po.delivery_address,
      orderDate: po.order_date,
      expectedDeliveryDate: po.expected_delivery_date,
      paymentTerms: po.payment_terms,
      currency: po.currency || 'ZAR',
      taxRate: parseFloat(po.tax_rate) || 15,
      subtotal: parseFloat(po.subtotal) || 0,
      taxAmount: parseFloat(po.tax_amount) || 0,
      totalAmount: parseFloat(po.total_amount) || 0,
      notes: po.internal_notes,
      supplierNotes: po.supplier_notes,
      createdBy: po.created_by,
      createdAt: po.created_at,
      updatedAt: po.updated_at,
      // Versioning
      version: po.version || 1,
      versionHistory,
      // Approval info
      currentApprovalRequestId: po.current_approval_request_id,
      approvedBy: po.approved_by,
      approvedAt: po.approved_at,
      // Odoo integration
      odooPoId: po.odoo_po_id || null,
      // Quote / supplier reference
      supplierReference: po.supplier_reference || null,
      quoteNumber: po.quote_number || null,
      quoteAttachmentUrl: po.quote_attachment_url || null,
      quoteAttachmentName: po.quote_attachment_name || null,
      department: po.department || null,
      // Quote comparison for approvers
      quoteComparison,
      items,
      history: historyResult.map(h => ({
        id: h.id,
        action: h.action,
        notes: h.notes,
        createdBy: h.created_by,
        createdAt: h.created_at,
      })),
      receipts: [] as { id: string; grnNumber: string; receivedDate: string; receivedBy: string; totalItems: number }[],
    };

    return apiResponse.success(res, purchaseOrder);
  } catch (error) {
    log.error('Failed to fetch purchase order detail', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const { action, notes, reason } = req.body;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id || 'system';
    const userName = authReq.user?.name || 'System';

    if (!action) {
      return apiResponse.badRequest(res, 'Action is required');
    }

    // Get current PO status
    const currentPO = await sql`
      SELECT status, version FROM purchase_orders WHERE id = ${id}
    `;

    if (currentPO.length === 0) {
      return apiResponse.notFound(res, 'Purchase order', id);
    }

    const currentStatus = currentPO[0]!.status;
    const currentVersion = currentPO[0]!.version || 1;

    // Handle approval workflow actions with the approval service
    switch (action) {
      case 'submit': {
        if (currentStatus !== 'draft') {
          return apiResponse.badRequest(res, 'Only draft POs can be submitted');
        }

        const result = await poApprovalService.submitForApproval(id, userId, userName);

        log.info('PO submitted for approval', { id, autoApproved: result.autoApproved });

        createAuditLog({
          entityType: 'purchase_order',
          entityId: id,
          action: 'update',
          performedBy: userId,
          performedByName: userName,
          oldValues: { status: currentStatus },
          newValues: { status: result.autoApproved ? 'approved' : 'pending_approval' },
        });

        return apiResponse.success(res, {
          id,
          status: result.autoApproved ? 'approved' : 'pending_approval',
          action: 'submitted',
          autoApproved: result.autoApproved,
          approvalRequest: result.approvalRequest,
        });
      }

      case 'approve': {
        if (currentStatus !== 'pending_approval') {
          return apiResponse.badRequest(res, 'Only pending POs can be approved');
        }

        await poApprovalService.approvePO(id, userId, userName, notes);

        log.info('PO approved', { id, approver: userName });

        createAuditLog({
          entityType: 'purchase_order',
          entityId: id,
          action: 'approve',
          performedBy: userId,
          performedByName: userName,
          oldValues: { status: currentStatus },
          newValues: { status: 'approved' },
        });

        return apiResponse.success(res, {
          id,
          status: 'approved',
          action: 'approved',
        });
      }

      case 'reject': {
        if (currentStatus !== 'pending_approval') {
          return apiResponse.badRequest(res, 'Only pending POs can be rejected');
        }

        if (!reason && !notes) {
          return apiResponse.badRequest(res, 'Rejection reason is required');
        }

        const result = await poApprovalService.rejectPO(id, userId, userName, reason || notes);

        log.info('PO rejected', { id, rejecter: userName, newVersion: result.newVersion });

        createAuditLog({
          entityType: 'purchase_order',
          entityId: id,
          action: 'reject',
          performedBy: userId,
          performedByName: userName,
          oldValues: { status: currentStatus },
          newValues: { status: 'draft' },
          reason: reason || notes,
        });

        return apiResponse.success(res, {
          id,
          status: 'draft',
          action: 'rejected',
          previousVersion: currentVersion,
          newVersion: result.newVersion,
        });
      }

      case 'send': {
        if (currentStatus !== 'approved') {
          return apiResponse.badRequest(res, 'Only approved POs can be sent');
        }
        await updatePOStatusSimple(id, 'sent', userId, notes);
        createAuditLog({
          entityType: 'purchase_order',
          entityId: id,
          action: 'update',
          performedBy: userId,
          performedByName: userName,
          oldValues: { status: currentStatus },
          newValues: { status: 'sent' },
        });
        return apiResponse.success(res, { id, status: 'sent', action: 'sent' });
      }

      case 'acknowledge': {
        if (currentStatus !== 'sent') {
          return apiResponse.badRequest(res, 'Only sent POs can be acknowledged');
        }
        await updatePOStatusSimple(id, 'acknowledged', userId, notes);
        createAuditLog({
          entityType: 'purchase_order',
          entityId: id,
          action: 'update',
          performedBy: userId,
          performedByName: userName,
          oldValues: { status: currentStatus },
          newValues: { status: 'acknowledged' },
        });
        return apiResponse.success(res, { id, status: 'acknowledged', action: 'acknowledged' });
      }

      case 'complete': {
        if (!['acknowledged', 'partial_receipt'].includes(currentStatus)) {
          return apiResponse.badRequest(res, 'Cannot complete PO in current status');
        }
        await updatePOStatusSimple(id, 'completed', userId, notes);
        createAuditLog({
          entityType: 'purchase_order',
          entityId: id,
          action: 'update',
          performedBy: userId,
          performedByName: userName,
          oldValues: { status: currentStatus },
          newValues: { status: 'completed' },
        });
        return apiResponse.success(res, { id, status: 'completed', action: 'completed' });
      }

      case 'cancel': {
        if (['completed', 'cancelled', 'draft'].includes(currentStatus)) {
          return apiResponse.badRequest(res, 'Cannot cancel PO in current status');
        }
        await updatePOStatusSimple(id, 'cancelled', userId, notes);
        createAuditLog({
          entityType: 'purchase_order',
          entityId: id,
          action: 'update',
          performedBy: userId,
          performedByName: userName,
          oldValues: { status: currentStatus },
          newValues: { status: 'cancelled' },
        });
        return apiResponse.success(res, { id, status: 'cancelled', action: 'cancelled' });
      }

      case 'update_fields': {
        // Allow field edits on Odoo-imported POs only
        const checkOdoo = await sql`SELECT odoo_po_id FROM purchase_orders WHERE id = ${id}`;
        if (!checkOdoo[0]?.odoo_po_id) {
          return apiResponse.badRequest(res, 'Field editing is only allowed for Odoo-imported POs');
        }

        const { fields } = req.body;
        if (!fields || typeof fields !== 'object') {
          return apiResponse.badRequest(res, 'Fields object is required');
        }

        const allowedFields: Record<string, string> = {
          expectedDeliveryDate: 'expected_delivery_date',
          orderDate: 'order_date',
          deliveryAddress: 'delivery_address',
          paymentTerms: 'payment_terms',
          internalNotes: 'internal_notes',
          supplierNotes: 'supplier_notes',
        };

        const updates: string[] = [];
        const values: (string | null)[] = [];
        let vi = 1;

        for (const [key, val] of Object.entries(fields)) {
          const col = allowedFields[key];
          if (!col) continue;
          updates.push(`${col} = $${vi}`);
          values.push(val as string | null);
          vi++;
        }

        if (updates.length === 0) {
          return apiResponse.badRequest(res, 'No valid fields to update');
        }

        updates.push(`updated_at = NOW()`);
        const updateQuery = `UPDATE purchase_orders SET ${updates.join(', ')} WHERE id = $${vi}`;
        values.push(id);

        await sql.query(updateQuery, values);

        await sql`
          INSERT INTO purchase_order_history (
            purchase_order_id, action, notes, created_by, created_at
          ) VALUES (
            ${id}, ${'edited'}, ${`Fields updated: ${Object.keys(fields).join(', ')}`}, ${userId}, NOW()
          )
        `;

        log.info('PO fields updated (Odoo)', { id, fields: Object.keys(fields) });

        createAuditLog({
          entityType: 'purchase_order',
          entityId: id,
          action: 'update',
          performedBy: userId,
          performedByName: userName,
          newValues: fields,
        });

        return apiResponse.success(res, { id, action: 'updated', fields: Object.keys(fields) });
      }

      default:
        return apiResponse.badRequest(res, `Invalid action: ${action}`);
    }
  } catch (error) {
    log.error('Failed to update purchase order status', error);
    return apiResponse.internalError(res, error);
  }
}

// Helper for non-approval status updates
async function updatePOStatusSimple(poId: string, status: string, userId: string, notes?: string) {
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

async function handleDelete(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    // Check if PO exists and is draft
    const currentPO = await sql`
      SELECT status FROM purchase_orders WHERE id = ${id}
    `;

    if (currentPO.length === 0) {
      return apiResponse.notFound(res, 'Purchase order', id);
    }

    if (currentPO[0]!.status !== 'draft') {
      return apiResponse.badRequest(res, 'Only draft purchase orders can be deleted');
    }

    // Delete history first (foreign key)
    await sql`DELETE FROM purchase_order_history WHERE purchase_order_id = ${id}`;

    // Delete items (foreign key)
    await sql`DELETE FROM purchase_order_items WHERE purchase_order_id = ${id}`;

    // Delete PO
    await sql`DELETE FROM purchase_orders WHERE id = ${id}`;

    log.info('Purchase order deleted', { id });

    return apiResponse.success(res, { deleted: true, id });
  } catch (error) {
    log.error('Failed to delete purchase order', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
