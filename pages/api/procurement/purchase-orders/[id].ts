// WORKING: Purchase Order Detail API - GET detail, PATCH status, DELETE
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
        s.company_name as supplier_name,
        s.contact_email as supplier_email,
        s.contact_phone as supplier_phone,
        po.project_id,
        p.project_name,
        po.delivery_address,
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
        po.updated_at
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN projects p ON po.project_id = p.id
      WHERE po.id = ${id}
    `;

    if (poResult.length === 0) {
      return apiResponse.notFound(res, 'Purchase order', id);
    }

    const po = poResult[0];

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
      items,
      // History and receipts - empty for now until tables are created
      history: [] as { id: string; action: string; notes: string | null; createdBy: string | null; createdAt: string }[],
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
    const { action, notes } = req.body;

    if (!action) {
      return apiResponse.badRequest(res, 'Action is required');
    }

    // Get current PO status
    const currentPO = await sql`
      SELECT status FROM purchase_orders WHERE id = ${id}
    `;

    if (currentPO.length === 0) {
      return apiResponse.notFound(res, 'Purchase order', id);
    }

    const currentStatus = currentPO[0].status;
    let newStatus: string | null = null;
    let historyAction: string = action;

    // Validate transition and determine new status
    switch (action) {
      case 'submit':
        if (currentStatus !== 'draft') {
          return apiResponse.badRequest(res, 'Only draft POs can be submitted');
        }
        newStatus = 'pending_approval';
        historyAction = 'submitted';
        break;

      case 'approve':
        if (currentStatus !== 'pending_approval') {
          return apiResponse.badRequest(res, 'Only pending POs can be approved');
        }
        newStatus = 'approved';
        historyAction = 'approved';
        break;

      case 'reject':
        if (currentStatus !== 'pending_approval') {
          return apiResponse.badRequest(res, 'Only pending POs can be rejected');
        }
        newStatus = 'draft';
        historyAction = 'rejected';
        break;

      case 'send':
        if (currentStatus !== 'approved') {
          return apiResponse.badRequest(res, 'Only approved POs can be sent');
        }
        newStatus = 'sent';
        historyAction = 'sent';
        break;

      case 'acknowledge':
        if (currentStatus !== 'sent') {
          return apiResponse.badRequest(res, 'Only sent POs can be acknowledged');
        }
        newStatus = 'acknowledged';
        historyAction = 'acknowledged';
        break;

      case 'complete':
        if (!['acknowledged', 'partial_receipt'].includes(currentStatus)) {
          return apiResponse.badRequest(res, 'Cannot complete PO in current status');
        }
        newStatus = 'completed';
        historyAction = 'completed';
        break;

      case 'cancel':
        if (['completed', 'cancelled', 'draft'].includes(currentStatus)) {
          return apiResponse.badRequest(res, 'Cannot cancel PO in current status');
        }
        newStatus = 'cancelled';
        historyAction = 'cancelled';
        break;

      default:
        return apiResponse.badRequest(res, `Invalid action: ${action}`);
    }

    // Update status
    await sql`
      UPDATE purchase_orders
      SET status = ${newStatus}, updated_at = NOW()
      WHERE id = ${id}
    `;

    // Add history event
    await sql`
      INSERT INTO purchase_order_history (
        purchase_order_id, action, notes, created_at
      ) VALUES (
        ${id}, ${historyAction}, ${notes || null}, NOW()
      )
    `;

    log.info('Purchase order status updated', { id, action, newStatus });

    return apiResponse.success(res, {
      id,
      status: newStatus,
      action: historyAction,
    });
  } catch (error) {
    log.error('Failed to update purchase order status', error);
    return apiResponse.internalError(res, error);
  }
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

    if (currentPO[0].status !== 'draft') {
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
