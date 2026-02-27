/**
 * Purchase Orders CSV Export
 * GET — export purchase orders as CSV with same filters as list endpoint
 *
 * Query params: status, supplierId, search
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { buildCSV, sendCSV, type CSVColumn } from '@/lib/csv';

const sql = neon(process.env.DATABASE_URL!);

const columns: CSVColumn[] = [
  { key: 'poNumber', label: 'PO Number' },
  { key: 'status', label: 'Status' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'project', label: 'Project' },
  { key: 'orderDate', label: 'Order Date' },
  { key: 'deliveryDate', label: 'Delivery Date' },
  { key: 'subtotal', label: 'Subtotal' },
  { key: 'vat', label: 'VAT' },
  { key: 'total', label: 'Total' },
  { key: 'items', label: 'Items' },
  { key: 'department', label: 'Department' },
  { key: 'createdBy', label: 'Created By' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const { status, supplierId, search } = req.query;

    const conditions: string[] = ['1=1'];
    const params: (string | number | string[])[] = [];
    let idx = 1;

    if (status && status !== 'all') {
      const statusArray = Array.isArray(status) ? status : (status as string).split(',');
      conditions.push(`po.status = ANY($${idx})`);
      params.push(statusArray);
      idx++;
    }
    if (supplierId) {
      conditions.push(`po.supplier_id = $${idx}`);
      params.push(parseInt(supplierId as string, 10));
      idx++;
    }
    if (search) {
      conditions.push(`(po.po_number ILIKE $${idx} OR s.name ILIKE $${idx} OR p.project_name ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const query = `
      SELECT
        po.po_number, po.status,
        COALESCE(s.company_name, s.name) as supplier_name,
        p.project_name, po.order_date, po.expected_delivery_date,
        po.subtotal, po.tax_amount, po.total_amount,
        (SELECT COUNT(*)::int FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count,
        po.department, po.created_by
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN projects p ON po.project_id = p.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY po.created_at DESC
      LIMIT 10000
    `;

    const rows = await sql.query(query, params);

    const mapped = rows.map((r: Record<string, unknown>) => ({
      poNumber: r.po_number,
      status: r.status,
      supplier: r.supplier_name || '',
      project: r.project_name || '',
      orderDate: r.order_date || '',
      deliveryDate: r.expected_delivery_date || '',
      subtotal: Number(r.subtotal) || 0,
      vat: Number(r.tax_amount) || 0,
      total: Number(r.total_amount) || 0,
      items: r.item_count,
      department: r.department || '',
      createdBy: r.created_by || '',
    }));

    const csv = buildCSV(columns, mapped);
    const filename = `purchase-orders-${new Date().toISOString().split('T')[0]}.csv`;
    return sendCSV(res, csv, filename);
  } catch (err) {
    log.error('Failed to export purchase orders', { error: err }, 'po-export');
    return apiResponse.internalError(res, err, 'Failed to export purchase orders');
  }
}

export default withAuth(withErrorHandler(handler));
