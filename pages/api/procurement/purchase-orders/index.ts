// WORKING: Purchase Orders API - GET list, POST create
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const params: (string | number | string[])[] = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      // Handle both single status and array of statuses (e.g., ?status=approved&status=sent)
      const statusArray = Array.isArray(status) ? status : [status];
      whereConditions.push(`po.status = ANY($${paramIndex})`);
      params.push(statusArray);
      paramIndex++;
    }

    if (supplierId) {
      whereConditions.push(`po.supplier_id = $${paramIndex}`);
      params.push(parseInt(supplierId as string, 10));
      paramIndex++;
    }

    if (search) {
      whereConditions.push(`(po.po_number ILIKE $${paramIndex} OR s.name ILIKE $${paramIndex} OR p.project_name ILIKE $${paramIndex} OR CAST(po.odoo_po_id AS TEXT) ILIKE $${paramIndex})`);
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
    // Sort column validated against allowlist (can't parameterize ORDER BY columns)
    const validSortColumns = ['created_at', 'po_number', 'total', 'delivery_date'] as const;
    const sortColumn = validSortColumns.includes(sortBy as typeof validSortColumns[number]) ? sortBy : 'created_at';
    const sortDirection = sortDir === 'asc' ? 'ASC' : 'DESC';

    const dataQuery = `
      SELECT
        po.id,
        po.po_number,
        po.status,
        po.supplier_id,
        COALESCE(s.company_name, s.name) as supplier_name,
        p.project_name as project_name,
        po.expected_delivery_date as delivery_date,
        po.subtotal,
        po.tax_amount as vat_amount,
        po.total_amount as total,
        COALESCE(po.version, 1) as version,
        (SELECT COUNT(*)::int FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
        po.department,
        po.created_by as created_by_name,
        po.created_at,
        po.order_date,
        po.odoo_po_id,
        po.supplier_reference,
        po.quote_number
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
      subtotal: parseFloat(row.subtotal as string) || 0,
      vatAmount: parseFloat(row.vat_amount as string) || 0,
      total: parseFloat(row.total as string) || 0,
      version: row.version || 1,
      itemCount: row.item_count || 0,
      department: row.department || null,
      createdByName: row.created_by_name || 'System',
      createdAt: row.created_at,
      orderDate: row.order_date || null,
      odooPoId: row.odoo_po_id || null,
      supplierReference: row.supplier_reference || null,
      quoteNumber: row.quote_number || null,
    }));

    return apiResponse.paginated(res, purchaseOrders, {
      page: pageNum,
      pageSize: pageSizeNum,
      total,
    });
  } catch (error) {
    log.error('Failed to fetch purchase orders', { error, module: 'procurement:purchase-orders' });
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const body = req.body;
    const supplierId = body.supplierId;
    const supplierContact = body.supplierContact;
    const supplierReference = body.supplierReference;
    const projectId = body.projectId;
    const deliveryAddress = body.deliveryAddress;
    // Accept both field names for delivery date
    const expectedDeliveryDate = body.expectedDeliveryDate || body.deliveryDate;
    const shippingMethod = body.shippingMethod;
    const paymentTerms = body.paymentTerms;
    const currency = body.currency || 'ZAR';
    // Accept both vatRate and taxRate
    const taxRate = body.taxRate ?? body.vatRate ?? 15;
    // Accept both note field names
    const internalNotes = body.internalNotes || body.notes;
    const supplierNotes = body.supplierNotes;
    const department = body.department;
    const quoteNumber = body.quoteNumber;
    const quoteAttachmentUrl = body.quoteAttachmentUrl;
    const quoteAttachmentName = body.quoteAttachmentName;
    const items = body.items;
    const createdBy = body.createdBy || 'system';

    // Validation
    if (!supplierId) {
      return apiResponse.badRequest(res, 'Supplier is required');
    }

    if (!deliveryAddress || deliveryAddress.trim().length < 10) {
      return apiResponse.badRequest(res, 'Delivery address must be at least 10 characters');
    }

    // Normalize payment terms - accept various formats
    const paymentTermsMap: Record<string, string> = {
      'cod': 'COD', 'COD': 'COD',
      'net7': 'Net 7', 'Net 7': 'Net 7', 'net 7': 'Net 7',
      'net14': 'Net 14', 'Net 14': 'Net 14', 'net 14': 'Net 14',
      'net15': 'Net 15', 'Net 15': 'Net 15', 'net 15': 'Net 15',
      'net30': 'Net 30', 'Net 30': 'Net 30', 'net 30': 'Net 30',
      'net45': 'Net 45', 'Net 45': 'Net 45', 'net 45': 'Net 45',
      'net60': 'Net 60', 'Net 60': 'Net 60', 'net 60': 'Net 60',
      'net90': 'Net 90', 'Net 90': 'Net 90', 'net 90': 'Net 90',
      'eom': 'EOM', 'EOM': 'EOM',
      'prepaid': 'Prepaid', 'Prepaid': 'Prepaid',
    };
    const normalizedPaymentTerms = paymentTermsMap[paymentTerms];
    if (!paymentTerms || !normalizedPaymentTerms) {
      return apiResponse.badRequest(res, 'Valid payment terms are required (e.g., Net 30, COD)');
    }

    if (taxRate < 0 || taxRate > 25) {
      return apiResponse.badRequest(res, 'Tax rate must be between 0 and 25%');
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return apiResponse.badRequest(res, 'At least one item is required');
    }

    // Validate items - accept both description and itemDescription
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const description = item.description || item.itemDescription;
      if (!description || description.trim().length < 3) {
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

    // Insert PO using explicit query method
    const insertQuery = `
      INSERT INTO purchase_orders (
        po_number, status, supplier_id, supplier_contact, supplier_reference,
        project_id, department, delivery_address, expected_delivery_date, shipping_method,
        payment_terms, currency, tax_rate, subtotal, tax_amount, total_amount,
        internal_notes, supplier_notes, created_by, quote_number, quote_attachment_url,
        quote_attachment_name, created_at, updated_at
      ) VALUES (
        $1, 'draft', $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, NOW(), NOW()
      )
      RETURNING id, po_number
    `;

    const poResult = await sql.query(insertQuery, [
      poNumber,
      supplierId,
      supplierContact || null,
      supplierReference || null,
      projectId || null,
      department || null,
      deliveryAddress,
      expectedDeliveryDate || null,
      shippingMethod || null,
      normalizedPaymentTerms,
      currency,
      taxRate,
      subtotal,
      taxAmount,
      totalAmount,
      internalNotes || null,
      supplierNotes || null,
      createdBy,
      quoteNumber || null,
      quoteAttachmentUrl || null,
      quoteAttachmentName || null,
    ]);

    const poId = poResult[0]!.id;

    // Insert items (matching actual schema columns)
    // Note: trigger tr_poi_totals recalculates PO totals from item tax_amounts
    for (const item of items) {
      const lineTotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
      const itemTaxAmount = Math.round(lineTotal * (taxRate / 100) * 100) / 100;
      const itemDescription = item.description || item.itemDescription;

      await sql`
        INSERT INTO purchase_order_items (
          purchase_order_id, item_code, item_description, quantity_ordered,
          quantity_received, uom, unit_price, tax_rate, tax_amount, total_price, notes, created_at
        ) VALUES (
          ${poId}, ${item.itemCode || null}, ${itemDescription}, ${item.quantity},
          0, ${item.uom}, ${item.unitPrice}, ${taxRate}, ${itemTaxAmount}, ${lineTotal}, ${item.notes || null}, NOW()
        )
      `;
    }

    log.info('Purchase order created', { poId, poNumber, totalAmount });

    createAuditLog({
      entityType: 'purchase_order',
      entityId: poId,
      action: 'create',
      performedBy: createdBy,
      performedByName: createdBy,
      newValues: { poNumber, totalAmount, supplierId },
    });

    return apiResponse.created(res, {
      id: poId,
      poNumber,
      status: 'draft',
      totalAmount,
    });
  } catch (error) {
    log.error('Failed to create purchase order', { error, module: 'procurement:purchase-orders' });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
