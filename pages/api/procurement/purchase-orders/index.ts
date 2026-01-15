// WORKING: Purchase Orders API - GET list, POST create
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { page = '1', pageSize = '50', status, supplierId, search, sortBy = 'created_at', sortDir = 'desc' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);
    const offset = (pageNum - 1) * pageSizeNum;

    // Build dynamic query
    let whereConditions = ['1=1'];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      whereConditions.push(`po.status = $${paramIndex}`);
      params.push(status as string);
      paramIndex++;
    }

    if (supplierId) {
      whereConditions.push(`po.supplier_id = $${paramIndex}`);
      params.push(parseInt(supplierId as string, 10));
      paramIndex++;
    }

    if (search) {
      whereConditions.push(`(po.po_number ILIKE $${paramIndex} OR s.company_name ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE ${whereClause}
    `;

    const countResult = await sql.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);

    // Get paginated results
    const validSortColumns = ['created_at', 'po_number', 'total', 'delivery_date'];
    const sortColumn = validSortColumns.includes(sortBy as string) ? sortBy : 'created_at';
    const sortDirection = sortDir === 'asc' ? 'ASC' : 'DESC';

    const dataQuery = `
      SELECT
        po.id,
        po.po_number,
        po.status,
        po.supplier_id,
        s.company_name as supplier_name,
        p.project_name as project_name,
        po.expected_delivery_date as delivery_date,
        po.subtotal,
        po.tax_amount as vat_amount,
        po.total_amount as total,
        (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
        po.created_by as created_by_name,
        po.created_at
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN projects p ON po.project_id = p.id
      WHERE ${whereClause}
      ORDER BY po.${sortColumn} ${sortDirection}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataResult = await sql.query(dataQuery, [...params, pageSizeNum, offset]);

    const purchaseOrders = dataResult.map((row: Record<string, unknown>) => ({
      id: row.id,
      poNumber: row.po_number,
      status: row.status,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name || 'Unknown Supplier',
      projectName: row.project_name,
      deliveryDate: row.delivery_date,
      subtotal: parseFloat(row.subtotal) || 0,
      vatAmount: parseFloat(row.vat_amount) || 0,
      total: parseFloat(row.total) || 0,
      itemCount: row.item_count || 0,
      createdByName: row.created_by_name || 'System',
      createdAt: row.created_at,
    }));

    return apiResponse.success(res, purchaseOrders, {
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      },
    });
  } catch (error) {
    log.error('Failed to fetch purchase orders', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      supplierId,
      supplierContact,
      supplierReference,
      projectId,
      deliveryAddress,
      expectedDeliveryDate,
      shippingMethod,
      paymentTerms,
      currency = 'ZAR',
      taxRate = 15,
      internalNotes,
      supplierNotes,
      items,
      createdBy = 'system', // Should come from auth
    } = req.body;

    // Validation
    if (!supplierId) {
      return apiResponse.badRequest(res, 'Supplier is required');
    }

    if (!deliveryAddress || deliveryAddress.trim().length < 10) {
      return apiResponse.badRequest(res, 'Delivery address must be at least 10 characters');
    }

    const validPaymentTerms = ['COD', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];
    if (!paymentTerms || !validPaymentTerms.includes(paymentTerms)) {
      return apiResponse.badRequest(res, 'Valid payment terms are required');
    }

    if (taxRate < 0 || taxRate > 25) {
      return apiResponse.badRequest(res, 'Tax rate must be between 0 and 25%');
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return apiResponse.badRequest(res, 'At least one item is required');
    }

    // Validate items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.description || item.description.trim().length < 3) {
        return apiResponse.badRequest(res, `Item ${i + 1}: Description must be at least 3 characters`);
      }
      if (!item.quantity || item.quantity <= 0) {
        return apiResponse.badRequest(res, `Item ${i + 1}: Quantity must be greater than 0`);
      }
      if (!item.uom || item.uom.trim() === '') {
        return apiResponse.badRequest(res, `Item ${i + 1}: Unit of measure is required`);
      }
      if (item.unitPrice === undefined || item.unitPrice < 0.01) {
        return apiResponse.badRequest(res, `Item ${i + 1}: Unit price must be at least 0.01`);
      }
    }

    // Calculate totals
    const subtotal = items.reduce((sum: number, item: { quantity: number; unitPrice: number }) => {
      return sum + Math.round(item.quantity * item.unitPrice * 100) / 100;
    }, 0);

    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

    // Generate PO number (PO-YYYY-NNNN format)
    const year = new Date().getFullYear();
    const seqResult = await sql`
      SELECT COUNT(*) + 1 as seq
      FROM purchase_orders
      WHERE po_number LIKE ${`PO-${year}-%`}
    `;
    const sequence = parseInt(seqResult[0]?.seq || '1', 10);
    const poNumber = `PO-${year}-${String(sequence).padStart(4, '0')}`;

    // Insert PO (matching actual schema columns)
    const poResult = await sql`
      INSERT INTO purchase_orders (
        po_number, status, supplier_id, supplier_contact, supplier_reference,
        project_id, delivery_address, expected_delivery_date, shipping_method,
        payment_terms, currency, tax_rate, subtotal, tax_amount, total_amount,
        internal_notes, supplier_notes, created_by, created_at, updated_at
      ) VALUES (
        ${poNumber}, 'draft', ${supplierId}, ${supplierContact || null}, ${supplierReference || null},
        ${projectId || null}, ${deliveryAddress}, ${expectedDeliveryDate || null}, ${shippingMethod || null},
        ${paymentTerms}, ${currency}, ${taxRate}, ${subtotal}, ${taxAmount}, ${totalAmount},
        ${internalNotes || null}, ${supplierNotes || null}, ${createdBy}, NOW(), NOW()
      )
      RETURNING id, po_number
    `;

    const poId = poResult[0].id;

    // Insert items (matching actual schema columns)
    for (const item of items) {
      const lineTotal = Math.round(item.quantity * item.unitPrice * 100) / 100;

      await sql`
        INSERT INTO purchase_order_items (
          purchase_order_id, item_code, item_description, quantity_ordered,
          quantity_received, uom, unit_price, total_price, notes, created_at
        ) VALUES (
          ${poId}, ${item.itemCode || null}, ${item.description}, ${item.quantity},
          0, ${item.uom}, ${item.unitPrice}, ${lineTotal}, ${item.notes || null}, NOW()
        )
      `;
    }

    log.info('Purchase order created', { poId, poNumber, totalAmount });

    return apiResponse.created(res, {
      id: poId,
      poNumber,
      status: 'draft',
      totalAmount,
    });
  } catch (error) {
    log.error('Failed to create purchase order', error);
    return apiResponse.internalError(res, error);
  }
}
