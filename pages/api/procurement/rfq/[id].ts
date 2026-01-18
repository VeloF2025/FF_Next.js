import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const rfq = rfqResult[0];

    // Get RFQ items
    const items = await sql`
      SELECT * FROM rfq_items
      WHERE rfq_id::text = ${id}
      ORDER BY line_number
    `;

    // Get suppliers info if invited
    let suppliers: any[] = [];
    if (rfq.invited_suppliers && Array.isArray(rfq.invited_suppliers) && rfq.invited_suppliers.length > 0) {
      suppliers = await sql`
        SELECT id, company_name, email, phone, status
        FROM suppliers
        WHERE id = ANY(${rfq.invited_suppliers})
      `;
    }

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
      })),
      suppliers: suppliers.map((s: any) => ({
        id: s.id,
        companyName: s.company_name,
        email: s.email,
        phone: s.phone,
        status: s.status,
      })),
      quotes: quotes.map((q: any) => ({
        id: q.id,
        supplierId: q.supplier_id,
        supplierName: q.supplier_name || 'Unknown Supplier',
        totalAmount: q.total_amount ? Number(q.total_amount) : 0,
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
    const { title, description, status, dueDate, items } = req.body;

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

      // Insert new items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await sql`
          INSERT INTO rfq_items (
            rfq_id, line_number, description, quantity, uom,
            specifications, estimated_unit_price
          ) VALUES (
            ${id}, ${i + 1}, ${item.description}, ${item.quantity}, ${item.unit},
            ${item.specifications || null}, ${item.estimatedUnitPrice || 0}
          )
        `;
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
    // Delete RFQ items first
    await sql`DELETE FROM rfq_items WHERE rfq_id::text = ${id}`;

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
