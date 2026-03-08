/**
 * Item Listing Report API
 * GET: Master list of all stock items with details
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/neon';
import { apiResponse } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

export default withAuth(withErrorHandler(async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const format = req.query.format as string;

    let rows: any[];
    if (category && search) {
      const like = `%${search}%`;
      rows = await sql`
        SELECT id, item_code, name, description, category, uom,
          list_price, standard_cost, qty_available, is_active
        FROM stock_items
        WHERE category = ${category} AND (name ILIKE ${like} OR item_code ILIKE ${like})
        ORDER BY name
      ` as any[];
    } else if (category) {
      rows = await sql`
        SELECT id, item_code, name, description, category, uom,
          list_price, standard_cost, qty_available, is_active
        FROM stock_items WHERE category = ${category}
        ORDER BY name
      ` as any[];
    } else if (search) {
      const like = `%${search}%`;
      rows = await sql`
        SELECT id, item_code, name, description, category, uom,
          list_price, standard_cost, qty_available, is_active
        FROM stock_items WHERE name ILIKE ${like} OR item_code ILIKE ${like}
        ORDER BY name
      ` as any[];
    } else {
      rows = await sql`
        SELECT id, item_code, name, description, category, uom,
          list_price, standard_cost, qty_available, is_active
        FROM stock_items ORDER BY name
      ` as any[];
    }

    const data = rows.map((r: any) => ({
      id: r.id,
      itemCode: r.item_code || '',
      name: r.name,
      description: r.description || '',
      category: r.category || 'uncategorized',
      uom: r.uom || '',
      sellingPrice: Number(r.list_price || 0),
      costPrice: Number(r.standard_cost || 0),
      qtyOnHand: Number(r.qty_available || 0),
      isActive: r.is_active,
    }));

    if (format === 'csv') {
      const header = 'Item Code,Name,Description,Category,UOM,Selling Price,Cost Price,Qty On Hand,Active';
      const csvRows = data.map(r =>
        `"${r.itemCode}","${r.name}","${r.description}","${r.category}","${r.uom}",${r.sellingPrice.toFixed(2)},${r.costPrice.toFixed(2)},${r.qtyOnHand},${r.isActive}`
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="item-listing.csv"');
      return res.send([header, ...csvRows].join('\n'));
    }

    return apiResponse.success(res, data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Item listing report error', { error: message });
    return apiResponse.badRequest(res, 'Failed to generate item listing');
  }
}));
