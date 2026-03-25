// WORKING: Convert Purchase Requisition to Purchase Order
// PRD-050 Phase 2: Core Procurement - PR to PO Conversion
import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface ConvertToPORequest {
  supplierId: number;
  deliveryAddress: string;
  expectedDeliveryDate?: string;
  paymentTerms?: string;
  notes?: string;
  itemIds?: string[]; // Optional: specific items to include, default all
}

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
  const user = authReq.user;
  const body = req.body as ConvertToPORequest;

  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Requisition ID is required' });
  }

  try {
    // Fetch the requisition
    const requisitions = await sql`
      SELECT
        pr.id, pr.requisition_number, pr.project_id, pr.cost_center_id,
        pr.status, pr.currency, pr.notes,
        p.project_name as project_name
      FROM purchase_requisitions pr
      LEFT JOIN projects p ON pr.project_id = p.id
      WHERE pr.id = ${id}
    `;

    if (requisitions.length === 0) {
      return apiResponse.notFound(res, 'Purchase Requisition', id);
    }

    const requisition = requisitions[0]!;

    // Validate status - only approved PRs can be converted
    if (requisition.status !== 'approved') {
      return apiResponse.validationError(res, {
        status: `Cannot convert a requisition with status "${requisition.status}". Only approved requisitions can be converted to PO.`,
      });
    }

    // Validate supplier is provided
    if (!body.supplierId) {
      return apiResponse.validationError(res, { supplierId: 'Supplier is required' });
    }

    // Validate delivery address
    if (!body.deliveryAddress || body.deliveryAddress.trim().length < 10) {
      return apiResponse.validationError(res, {
        deliveryAddress: 'Delivery address is required (min 10 characters)',
      });
    }

    // Get supplier info
    const suppliers = await sql`
      SELECT id, company_name, contact_name, email, phone
      FROM suppliers WHERE id = ${body.supplierId}
    `;

    if (suppliers.length === 0) {
      return apiResponse.validationError(res, { supplierId: 'Supplier not found' });
    }

    const supplier = suppliers[0]!;

    // Fetch requisition items
    let itemsQuery;
    if (body.itemIds && body.itemIds.length > 0) {
      // Convert itemIds to proper query
      itemsQuery = await sql`
        SELECT
          id, requisition_id, stock_item_id, boq_item_id, item_code,
          item_description, quantity, uom, estimated_unit_price,
          converted_to_po, po_id, created_at
        FROM purchase_requisition_items
        WHERE requisition_id = ${id}
        AND id = ANY(${body.itemIds}::uuid[])
        AND converted_to_po = false
        ORDER BY created_at
      `;
    } else {
      itemsQuery = await sql`
        SELECT
          id, requisition_id, stock_item_id, boq_item_id, item_code,
          item_description, quantity, uom, estimated_unit_price,
          converted_to_po, po_id, created_at
        FROM purchase_requisition_items
        WHERE requisition_id = ${id}
        AND converted_to_po = false
        ORDER BY created_at
      `;
    }

    if (itemsQuery.length === 0) {
      return apiResponse.validationError(res, {
        items: 'No unconverted items found in this requisition',
      });
    }

    const items = itemsQuery;

    // Calculate totals
    const taxRate = 15;
    const subtotal = items.reduce((sum: number, item: Record<string, unknown>) => {
      const price = Number(item.estimated_unit_price) || 0;
      const qty = Number(item.quantity) || 0;
      return sum + Math.round(price * qty * 100) / 100;
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
    const sequence = parseInt(String(seqResult[0]?.seq) || '1', 10);
    const poNumber = `PO-${year}-${String(sequence).padStart(4, '0')}`;

    // Create the Purchase Order
    const poResult = await sql`
      INSERT INTO purchase_orders (
        po_number,
        status,
        supplier_id,
        supplier_contact,
        project_id,
        cost_center_id,
        delivery_address,
        expected_delivery_date,
        payment_terms,
        currency,
        tax_rate,
        subtotal,
        tax_amount,
        total_amount,
        internal_notes,
        created_by,
        requisition_id
      ) VALUES (
        ${poNumber},
        'draft',
        ${body.supplierId},
        ${supplier.contact_name || null},
        ${requisition.project_id || null},
        ${requisition.cost_center_id || null},
        ${body.deliveryAddress.trim()},
        ${body.expectedDeliveryDate || null},
        ${body.paymentTerms || 'Net 30'},
        ${requisition.currency || 'ZAR'},
        ${taxRate},
        ${subtotal},
        ${taxAmount},
        ${totalAmount},
        ${body.notes || `Converted from PR ${requisition.requisition_number}`},
        ${user?.name || userId || 'system'},
        ${id}
      )
      RETURNING id, po_number, status, supplier_id
    `;

    const newPO = poResult[0]!;

    // Insert PO items (must include tax_rate + tax_amount — tr_poi_totals trigger
    // recalculates PO totals from item-level tax_amount)
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const unitPrice = Number(item.estimated_unit_price) || 0;
      const quantity = Number(item.quantity) || 0;
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      const itemTaxAmount = Math.round(lineTotal * (taxRate / 100) * 100) / 100;

      await sql`
        INSERT INTO purchase_order_items (
          purchase_order_id,
          item_code,
          stock_item_id,
          boq_item_id,
          item_description,
          quantity_ordered,
          uom,
          unit_price,
          tax_rate,
          tax_amount,
          total_price,
          requisition_item_id
        ) VALUES (
          ${newPO.id},
          ${item.item_code || `ITEM-${i + 1}`},
          ${item.stock_item_id || null},
          ${item.boq_item_id || null},
          ${item.item_description || 'Item'},
          ${quantity},
          ${item.uom || 'EA'},
          ${unitPrice},
          ${taxRate},
          ${itemTaxAmount},
          ${lineTotal},
          ${item.id}
        )
      `;

      // Mark requisition item as converted
      await sql`
        UPDATE purchase_requisition_items
        SET
          converted_to_po = true,
          po_id = ${newPO.id}
        WHERE id = ${item.id}
      `;
    }

    // Check if all items are now converted
    const unconvertedCheck = await sql`
      SELECT COUNT(*) as count
      FROM purchase_requisition_items
      WHERE requisition_id = ${id}
      AND converted_to_po = false
    `;

    const allConverted = parseInt(String(unconvertedCheck[0]?.count) || '0', 10) === 0;

    // Update requisition status
    await sql`
      UPDATE purchase_requisitions
      SET
        status = ${allConverted ? 'ordered' : 'partially_ordered'},
        updated_at = NOW()
      WHERE id = ${id}
    `;

    log.info({
      module: 'procurement',
      action: 'requisition_converted_to_po',
      requisitionId: id,
      requisitionNumber: requisition.requisition_number,
      purchaseOrderId: newPO.id,
      poNumber: newPO.po_number,
      itemCount: items.length,
      convertedBy: userId,
    });

    return apiResponse.created(res, {
      purchaseOrder: {
        id: newPO.id,
        poNumber: newPO.po_number,
        status: newPO.status,
        supplierId: newPO.supplier_id,
        supplierName: supplier.company_name,
        subtotal,
        taxAmount,
        total: totalAmount,
        itemCount: items.length,
      },
      requisition: {
        id: requisition.id,
        requisitionNumber: requisition.requisition_number,
        newStatus: allConverted ? 'ordered' : 'partially_ordered',
      },
    }, `Purchase Order ${poNumber} created successfully`);
  } catch (error) {
    log.error('Failed to convert requisition to PO', error);
    return apiResponse.databaseError(res, error, 'Failed to convert requisition to PO');
  }
}));
