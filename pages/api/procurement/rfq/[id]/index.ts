import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'RFQ ID is required');
  }

  if (req.method === 'GET') {
    return handleGet(req, res, id);
  } else if (req.method === 'PUT') {
    return handlePut(req, res, id);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res, id);
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT', 'DELETE']);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    // Get RFQ with project name - cast to text to avoid type mismatch
    const rfqResult = await sql`
      SELECT
        r.*,
        p.project_name,
        (SELECT COUNT(*) FROM quotes WHERE quotes.rfq_id = r.id)::int as quotes_received
      FROM rfqs r
      LEFT JOIN projects p ON r.project_id::text = p.id::text
      WHERE r.id::text = ${id}
    `;

    if (rfqResult.length === 0) {
      return apiResponse.notFound(res, 'RFQ', id);
    }

    const rfq = rfqResult[0]!;

    // Get RFQ items with stock item info
    const items = await sql`
      SELECT ri.*, si.description as stock_item_description, si.item_code as stock_item_code
      FROM rfq_items ri
      LEFT JOIN stock_items si ON ri.stock_item_id = si.id
      WHERE ri.rfq_id::text = ${id}
      ORDER BY ri.line_number
    `;

    // Get suppliers from junction table with status tracking
    const suppliers = await sql`
      SELECT
        s.id, s.company_name, s.name, s.email, s.phone, s.status as supplier_status,
        rs.id as rfq_supplier_id, rs.status, rs.invited_at, rs.viewed_at,
        rs.responded_at, rs.invitation_sent, rs.notes
      FROM rfq_suppliers rs
      JOIN suppliers s ON rs.supplier_id = s.id
      WHERE rs.rfq_id::text = ${id}
      ORDER BY rs.invited_at
    `;

    // Get quotes for this RFQ
    const quotes = await sql`
      SELECT
        q.*,
        s.company_name as supplier_name
      FROM quotes q
      LEFT JOIN suppliers s ON q.supplier_id::text = s.id::text
      WHERE q.rfq_id::text = ${id}
      ORDER BY q.created_at DESC
    `;

    const transformedRFQ = {
      id: rfq.id,
      rfqNumber: rfq.rfq_number,
      projectId: rfq.project_id,
      projectName: rfq.project_name || 'Unknown Project',
      title: rfq.title,
      description: rfq.description || '',
      status: rfq.status,
      createdDate: rfq.created_at,
      dueDate: rfq.response_deadline,
      items: items.map((item: any) => ({
        id: item.id,
        lineNumber: item.line_number,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.uom,
        specifications: item.specifications,
        estimatedUnitPrice: item.estimated_unit_price ? Number(item.estimated_unit_price) : 0,
        stockItemId: item.stock_item_id,
        stockItemDescription: item.stock_item_description,
        stockItemCode: item.stock_item_code,
        boqItemId: item.boq_item_id,
      })),
      suppliers: suppliers.map((s: any) => ({
        id: s.id,
        rfqSupplierId: s.rfq_supplier_id,
        companyName: s.company_name || s.name,
        email: s.email,
        phone: s.phone,
        supplierStatus: s.supplier_status,
        invitationStatus: s.status,
        invitedAt: s.invited_at,
        viewedAt: s.viewed_at,
        respondedAt: s.responded_at,
        invitationSent: s.invitation_sent,
        notes: s.notes,
      })),
      quotes: quotes.map((q: any) => ({
        id: q.id,
        supplierId: q.supplier_id,
        supplierName: q.supplier_name || 'Unknown Supplier',
        totalAmount: q.total_value ? Number(q.total_value) : 0,
        status: q.status,
        validUntil: q.valid_until,
        submittedAt: q.created_at,
        notes: q.notes,
      })),
      quotesReceived: rfq.quotes_received || 0,
      totalValue: rfq.total_budget_estimate ? Number(rfq.total_budget_estimate) : 0,
      createdBy: rfq.created_by || 'System',
      updatedAt: rfq.updated_at,
    };

    return apiResponse.success(res, transformedRFQ);
  } catch (error) {
    log.error('Failed to fetch RFQ', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const { title, description, status, dueDate, items, suppliers, supplierIds } = req.body;

    // Update RFQ
    const updated = await sql`
      UPDATE rfqs
      SET
        title = COALESCE(${title}, title),
        description = COALESCE(${description}, description),
        status = COALESCE(${status}, status),
        response_deadline = COALESCE(${dueDate}, response_deadline),
        updated_at = NOW()
      WHERE id::text = ${id}
      RETURNING *
    `;

    if (updated.length === 0) {
      return apiResponse.notFound(res, 'RFQ', id);
    }

    // Update items if provided
    if (items && Array.isArray(items)) {
      // Delete existing items
      await sql`DELETE FROM rfq_items WHERE rfq_id::text = ${id}`;

      // Insert new items with stock_item_id and boq_item_id support
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await sql`
          INSERT INTO rfq_items (
            rfq_id, line_number, description, quantity, uom,
            specifications, estimated_unit_price, stock_item_id, boq_item_id
          ) VALUES (
            ${id}, ${i + 1}, ${item.description}, ${item.quantity}, ${item.unit || item.uom || 'EA'},
            ${item.specifications || null}, ${item.estimatedUnitPrice || item.estimated_unit_price || 0},
            ${item.stockItemId || item.stock_item_id || null},
            ${item.boqItemId || item.boq_item_id || null}
          )
        `;
      }
    }

    // Update suppliers if provided (via junction table)
    const supplierList = suppliers || supplierIds;
    if (supplierList && Array.isArray(supplierList)) {
      // Get existing suppliers to preserve their status/tracking data
      const existingSuppliers = await sql`
        SELECT supplier_id, status, viewed_at, responded_at
        FROM rfq_suppliers WHERE rfq_id::text = ${id}
      `;
      const existingMap = new Map(existingSuppliers.map((s: any) => [s.supplier_id, s]));

      // Delete suppliers not in the new list
      await sql`DELETE FROM rfq_suppliers WHERE rfq_id::text = ${id}`;

      // Insert/re-insert suppliers
      for (const supplierId of supplierList) {
        if (supplierId) {
          const sid = typeof supplierId === 'object' ? supplierId.id : parseInt(supplierId);
          const existing = existingMap.get(sid);
          try {
            await sql`
              INSERT INTO rfq_suppliers (
                rfq_id, supplier_id, status, viewed_at, responded_at
              ) VALUES (
                ${id}, ${sid},
                ${existing?.status || 'invited'},
                ${existing?.viewed_at || null},
                ${existing?.responded_at || null}
              )
              ON CONFLICT (rfq_id, supplier_id) DO NOTHING
            `;
          } catch (e) {
            log.warn('Skipping invalid supplier ID during RFQ update', { data: { rfqId: id, error: String(e) } }, 'rfq');
          }
        }
      }
    }

    log.info('RFQ updated', { rfqId: id });
    return apiResponse.success(res, { id, message: 'RFQ updated successfully' });
  } catch (error) {
    log.error('Failed to update RFQ', error);
    return apiResponse.internalError(res, error);
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    // Delete related records first (CASCADE also handles this, but explicit is clearer)
    await sql`DELETE FROM rfq_items WHERE rfq_id::text = ${id}`;
    await sql`DELETE FROM rfq_suppliers WHERE rfq_id::text = ${id}`;

    // Delete RFQ
    const deleted = await sql`
      DELETE FROM rfqs WHERE id::text = ${id}
      RETURNING id
    `;

    if (deleted.length === 0) {
      return apiResponse.notFound(res, 'RFQ', id);
    }

    log.info('RFQ deleted', { rfqId: id });
    return apiResponse.success(res, { message: 'RFQ deleted successfully' });
  } catch (error) {
    log.error('Failed to delete RFQ', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
