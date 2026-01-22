/**
 * RFQ to Purchase Order Conversion API
 * POST /api/procurement/rfq/[id]/convert-to-po
 *
 * Converts an awarded RFQ to a Purchase Order
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { id: rfqId } = req.query;

  if (!rfqId || typeof rfqId !== 'string') {
    return apiResponse.badRequest(res, 'RFQ ID is required');
  }

  try {
    const {
      supplierId,
      quoteId,
      deliveryAddress,
      expectedDeliveryDate,
      paymentTerms = 'Net 30',
      taxRate = 15,
      internalNotes,
      createdBy = 'System',
      items: customItems, // Optional: override items from RFQ
    } = req.body;

    // Validate required fields
    if (!supplierId) {
      return apiResponse.badRequest(res, 'Supplier ID is required');
    }

    if (!deliveryAddress || deliveryAddress.trim().length < 10) {
      return apiResponse.badRequest(res, 'Delivery address must be at least 10 characters');
    }

    // Verify RFQ exists and is in valid status for conversion
    const rfqResult = await sql`
      SELECT
        r.id, r.rfq_number, r.title, r.project_id, r.status, r.total_budget_estimate,
        r.requisition_id,
        pr.requisition_number,
        p.project_name
      FROM rfqs r
      LEFT JOIN projects p ON r.project_id::text = p.id::text
      LEFT JOIN purchase_requisitions pr ON r.requisition_id = pr.id
      WHERE r.id::text = ${rfqId}
    `;

    if (rfqResult.length === 0) {
      return apiResponse.notFound(res, 'RFQ', rfqId);
    }

    const rfq = rfqResult[0]!;

    // Allow conversion from awarded or evaluating status
    if (!['awarded', 'evaluating'].includes(rfq.status)) {
      return apiResponse.badRequest(
        res,
        `RFQ must be in 'awarded' or 'evaluating' status to convert to PO. Current status: ${rfq.status}`
      );
    }

    // Verify supplier exists and was invited to this RFQ
    const supplierResult = await sql`
      SELECT
        s.id, s.company_name, s.contact_email, s.contact_phone,
        rs.status as rfq_supplier_status
      FROM suppliers s
      LEFT JOIN rfq_suppliers rs ON rs.supplier_id = s.id AND rs.rfq_id::text = ${rfqId}
      WHERE s.id = ${parseInt(supplierId, 10)}
    `;

    if (supplierResult.length === 0) {
      return apiResponse.badRequest(res, 'Supplier not found');
    }

    const supplier = supplierResult[0]!;

    // Get RFQ items (or use custom items if provided)
    let poItems;
    if (customItems && Array.isArray(customItems) && customItems.length > 0) {
      // Use custom items provided in request
      poItems = customItems;
    } else {
      // Fetch items from RFQ
      const rfqItemsResult = await sql`
        SELECT
          id, line_number, item_code, description, quantity, uom,
          budget_price, specifications, stock_item_id
        FROM rfq_items
        WHERE rfq_id::text = ${rfqId}
        ORDER BY line_number
      `;

      if (rfqItemsResult.length === 0) {
        return apiResponse.badRequest(res, 'RFQ has no items to convert');
      }

      poItems = rfqItemsResult.map((item: any) => ({
        itemCode: item.item_code,
        description: item.description,
        quantity: Number(item.quantity),
        uom: item.uom || 'EA',
        unitPrice: Number(item.budget_price) || 0,
        stockItemId: item.stock_item_id,
        specifications: item.specifications,
      }));
    }

    // Calculate totals
    const subtotal = poItems.reduce((sum: number, item: any) => {
      return sum + Math.round(item.quantity * item.unitPrice * 100) / 100;
    }, 0);

    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

    // Generate PO number
    const year = new Date().getFullYear();
    const seqResult = await sql`
      SELECT COUNT(*) + 1 as seq
      FROM purchase_orders
      WHERE po_number LIKE ${`PO-${year}-%`}
    `;
    const sequence = parseInt(seqResult[0]?.seq || '1', 10);
    const poNumber = `PO-${year}-${String(sequence).padStart(4, '0')}`;

    // Create the Purchase Order (with requisition_id for full lineage tracking)
    const poResult = await sql`
      INSERT INTO purchase_orders (
        po_number, status, rfq_id, quote_id, requisition_id, supplier_id,
        project_id, delivery_address, expected_delivery_date,
        payment_terms, currency, tax_rate, subtotal, tax_amount, total_amount,
        internal_notes, created_by, created_at, updated_at
      ) VALUES (
        ${poNumber}, 'draft', ${rfqId}::uuid, ${quoteId || null}, ${rfq.requisition_id || null}, ${parseInt(supplierId, 10)},
        ${rfq.project_id}, ${deliveryAddress}, ${expectedDeliveryDate || null},
        ${paymentTerms}, 'ZAR', ${taxRate}, ${subtotal}, ${taxAmount}, ${totalAmount},
        ${internalNotes || `Created from RFQ ${rfq.rfq_number}`}, ${createdBy}, NOW(), NOW()
      )
      RETURNING id
    `;

    const poId = poResult[0]!.id;

    // Insert PO items
    for (let i = 0; i < poItems.length; i++) {
      const item = poItems[i];
      const lineTotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
      const itemTaxAmount = Math.round(lineTotal * (taxRate / 100) * 100) / 100;

      await sql`
        INSERT INTO purchase_order_items (
          purchase_order_id, item_code, item_description, quantity_ordered,
          quantity_received, uom, unit_price, tax_rate, tax_amount, total_price,
          notes, created_at
        ) VALUES (
          ${poId}, ${item.itemCode || null}, ${item.description}, ${item.quantity},
          0, ${item.uom}, ${item.unitPrice}, ${taxRate}, ${itemTaxAmount}, ${lineTotal},
          ${item.specifications || null}, NOW()
        )
      `;
    }

    // Update RFQ status to awarded if not already
    if (rfq.status === 'evaluating') {
      await sql`
        UPDATE rfqs
        SET status = 'awarded', updated_at = NOW()
        WHERE id::text = ${rfqId}
      `;
    }

    // Log the conversion
    log.info('RFQ converted to PO', {
      rfqId,
      rfqNumber: rfq.rfq_number,
      poId,
      poNumber,
      supplierId,
      totalAmount,
    });

    return apiResponse.created(res, {
      purchaseOrder: {
        id: poId,
        poNumber,
        status: 'draft',
        supplierId: parseInt(supplierId, 10),
        supplierName: supplier.company_name,
        projectId: rfq.project_id,
        projectName: rfq.project_name,
        requisitionId: rfq.requisition_id || null,
        requisitionNumber: rfq.requisition_number || null,
        totalAmount,
        itemCount: poItems.length,
      },
      sourceRfq: {
        id: rfqId,
        rfqNumber: rfq.rfq_number,
        title: rfq.title,
      },
      sourceRequisition: rfq.requisition_id ? {
        id: rfq.requisition_id,
        requisitionNumber: rfq.requisition_number,
      } : null,
    }, 'RFQ successfully converted to Purchase Order');
  } catch (error) {
    log.error('Failed to convert RFQ to PO', { rfqId, error });
    return apiResponse.internalError(res, error);
  }
}
