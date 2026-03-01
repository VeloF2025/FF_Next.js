/**
 * Stock Items CSV Export
 * GET — export stock items as CSV with same filters as list endpoint
 *
 * Query params: search, category, hasStock, odooOnly
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { buildCSV, sendCSV, type CSVColumn } from '@/lib/csv';

const sql = neon(process.env.DATABASE_URL!);

const columns: CSVColumn[] = [
  { key: 'itemCode', label: 'Item Code' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'uom', label: 'UOM' },
  { key: 'trackingType', label: 'Tracking Type' },
  { key: 'qtyAvailable', label: 'Qty Available' },
  { key: 'qtyReserved', label: 'Qty Reserved' },
  { key: 'qtyOnOrder', label: 'Qty On Order' },
  { key: 'standardCost', label: 'Standard Cost' },
  { key: 'minStock', label: 'Min Stock' },
  { key: 'maxStock', label: 'Max Stock' },
  { key: 'reorderQty', label: 'Reorder Qty' },
  { key: 'status', label: 'Status' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const { search, category, hasStock, odooOnly } = req.query;

    const conditions: string[] = ['1=1'];
    const params: (string | number)[] = [];
    let idx = 1;

    if (search) {
      const pattern = `%${search}%`;
      conditions.push(`(item_code ILIKE $${idx} OR name ILIKE $${idx} OR description ILIKE $${idx})`);
      params.push(pattern);
      idx++;
    }
    if (category) {
      conditions.push(`category = $${idx}`);
      params.push(category as string);
      idx++;
    }
    if (hasStock === 'true') {
      conditions.push('qty_available > 0');
    }
    if (odooOnly === 'true') {
      conditions.push('odoo_product_id IS NOT NULL');
    }

    const query = `
      SELECT item_code, name, description, category, uom, tracking_type,
        qty_available, qty_reserved, qty_on_order, standard_cost,
        min_stock_level, max_stock_level, reorder_quantity, is_active
      FROM stock_items
      WHERE ${conditions.join(' AND ')}
      ORDER BY item_code ASC
      LIMIT 10000
    `;

    const rows = await sql.query(query, params);

    const mapped = rows.map((r: Record<string, unknown>) => ({
      itemCode: r.item_code,
      name: r.name,
      description: r.description || '',
      category: r.category,
      uom: r.uom,
      trackingType: r.tracking_type,
      qtyAvailable: Number(r.qty_available) || 0,
      qtyReserved: Number(r.qty_reserved) || 0,
      qtyOnOrder: Number(r.qty_on_order) || 0,
      standardCost: r.standard_cost ? Number(r.standard_cost) : '',
      minStock: r.min_stock_level ?? '',
      maxStock: r.max_stock_level ?? '',
      reorderQty: r.reorder_quantity ?? '',
      status: r.is_active ? 'Active' : 'Inactive',
    }));

    const csv = buildCSV(columns, mapped);
    const filename = `stock-items-${new Date().toISOString().split('T')[0]}.csv`;
    return sendCSV(res, csv, filename);
  } catch (err) {
    log.error('Failed to export stock items', { error: err }, 'stock-items-export');
    return apiResponse.internalError(res, err, 'Failed to export stock items');
  }
}

export default withAuth(handler);
