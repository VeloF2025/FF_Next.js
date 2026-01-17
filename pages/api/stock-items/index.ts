/**
 * Stock Items API - List & Create
 *
 * GET  - List all stock items with filtering and pagination
 * POST - Create new stock item
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';

const DATABASE_URL = process.env.DATABASE_URL || '';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sql = neon(DATABASE_URL);

  // GET - List stock items
  if (req.method === 'GET') {
    try {
      const {
        search,
        category,
        hasStock,
        odooOnly,
        page = '1',
        limit = '50',
        sortBy = 'item_code',
        sortOrder = 'asc',
      } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 200);
      const offset = (pageNum - 1) * limitNum;

      // Validate sort column
      const validSortColumns = ['item_code', 'name', 'category', 'qty_available', 'standard_cost', 'created_at', 'updated_at'];
      const sortColumn = validSortColumns.includes(sortBy as string) ? sortBy : 'item_code';
      const sortDir = sortOrder === 'desc' ? 'DESC' : 'ASC';

      // Build query based on filters - using separate queries for different filter combinations
      let items;
      let countResult;

      if (search && category && hasStock === 'true' && odooOnly === 'true') {
        const searchPattern = `%${search}%`;
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND category = ${category}
          AND qty_available > 0
          AND odoo_product_id IS NOT NULL
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND category = ${category}
          AND qty_available > 0
          AND odoo_product_id IS NOT NULL
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (search && category && hasStock === 'true') {
        const searchPattern = `%${search}%`;
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND category = ${category}
          AND qty_available > 0
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND category = ${category}
          AND qty_available > 0
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (search && category) {
        const searchPattern = `%${search}%`;
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND category = ${category}
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND category = ${category}
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (search && hasStock === 'true') {
        const searchPattern = `%${search}%`;
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND qty_available > 0
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND qty_available > 0
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (search && odooOnly === 'true') {
        const searchPattern = `%${search}%`;
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND odoo_product_id IS NOT NULL
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          AND odoo_product_id IS NOT NULL
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (search) {
        const searchPattern = `%${search}%`;
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE (item_code ILIKE ${searchPattern} OR name ILIKE ${searchPattern} OR description ILIKE ${searchPattern})
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (category && hasStock === 'true' && odooOnly === 'true') {
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE category = ${category} AND qty_available > 0 AND odoo_product_id IS NOT NULL
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE category = ${category} AND qty_available > 0 AND odoo_product_id IS NOT NULL
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (category && hasStock === 'true') {
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE category = ${category} AND qty_available > 0
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE category = ${category} AND qty_available > 0
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (category && odooOnly === 'true') {
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE category = ${category} AND odoo_product_id IS NOT NULL
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE category = ${category} AND odoo_product_id IS NOT NULL
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (category) {
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items WHERE category = ${category}
        `;
        items = await sql`
          SELECT * FROM stock_items WHERE category = ${category}
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (hasStock === 'true' && odooOnly === 'true') {
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items
          WHERE qty_available > 0 AND odoo_product_id IS NOT NULL
        `;
        items = await sql`
          SELECT * FROM stock_items
          WHERE qty_available > 0 AND odoo_product_id IS NOT NULL
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (hasStock === 'true') {
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items WHERE qty_available > 0
        `;
        items = await sql`
          SELECT * FROM stock_items WHERE qty_available > 0
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else if (odooOnly === 'true') {
        countResult = await sql`
          SELECT COUNT(*) as total FROM stock_items WHERE odoo_product_id IS NOT NULL
        `;
        items = await sql`
          SELECT * FROM stock_items WHERE odoo_product_id IS NOT NULL
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      } else {
        countResult = await sql`SELECT COUNT(*) as total FROM stock_items`;
        items = await sql`
          SELECT * FROM stock_items
          ORDER BY item_code ASC
          LIMIT ${limitNum} OFFSET ${offset}
        `;
      }

      const total = parseInt(String(countResult[0]?.total || 0), 10);

      // Get categories for filter dropdown
      const categoriesResult = await sql`
        SELECT DISTINCT category, COUNT(*) as count
        FROM stock_items
        GROUP BY category
        ORDER BY count DESC
      `;

      return res.status(200).json({
        data: items.map(mapDbToStockItem),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
        filters: {
          categories: categoriesResult.map(c => ({
            value: c.category,
            count: parseInt(String(c.count), 10),
          })),
        },
      });
    } catch (error) {
      console.error('Error fetching stock items:', error);
      return res.status(500).json({ error: 'Failed to fetch stock items' });
    }
  }

  // POST - Create stock item
  if (req.method === 'POST') {
    try {
      const body = req.body;

      // Validate required fields
      if (!body.itemCode || !body.name || !body.category) {
        return res.status(400).json({ error: 'Item code, name, and category are required' });
      }

      // Check for duplicate item code
      const [existing] = await sql`
        SELECT id FROM stock_items WHERE LOWER(item_code) = LOWER(${body.itemCode})
      `;
      if (existing) {
        return res.status(409).json({ error: 'Item with this code already exists' });
      }

      const [created] = await sql`
        INSERT INTO stock_items (
          item_code, name, description, category, tracking_type, uom,
          standard_cost, list_price, currency, min_stock_level, max_stock_level,
          reorder_quantity, is_active, is_returnable, product_type,
          purchase_ok, sale_ok, qty_available, created_by
        ) VALUES (
          ${body.itemCode}, ${body.name}, ${body.description || null},
          ${body.category}, ${body.trackingType || 'quantity'}, ${body.uom || 'EA'},
          ${body.standardCost || null}, ${body.listPrice || null},
          ${body.currency || 'ZAR'}, ${body.minStockLevel || 0},
          ${body.maxStockLevel || null}, ${body.reorderQuantity || null},
          ${body.isActive !== false}, ${body.isReturnable || false},
          ${body.productType || 'consu'}, ${body.purchaseOk !== false},
          ${body.saleOk || false}, ${body.qtyAvailable || 0},
          ${body.createdBy || 'api'}
        )
        RETURNING *
      `;

      return res.status(201).json({ data: mapDbToStockItem(created as Record<string, unknown>) });
    } catch (error: unknown) {
      console.error('Error creating stock item:', error);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        return res.status(409).json({ error: 'Item with this code already exists' });
      }
      return res.status(500).json({ error: 'Failed to create stock item' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withArcjetProtection(handler, aj);

// Map database row to API response
function mapDbToStockItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    itemCode: row.item_code,
    name: row.name,
    description: row.description,
    category: row.category,
    trackingType: row.tracking_type,
    uom: row.uom,
    standardCost: row.standard_cost ? Number(row.standard_cost) : null,
    listPrice: row.list_price ? Number(row.list_price) : null,
    currency: row.currency,
    minStockLevel: row.min_stock_level,
    maxStockLevel: row.max_stock_level,
    reorderQuantity: row.reorder_quantity,
    isActive: row.is_active,
    isReturnable: row.is_returnable,
    productType: row.product_type,
    purchaseOk: row.purchase_ok,
    saleOk: row.sale_ok,
    qtyAvailable: row.qty_available ? Number(row.qty_available) : 0,
    qtyReserved: row.qty_reserved ? Number(row.qty_reserved) : 0,
    qtyOnOrder: row.qty_on_order ? Number(row.qty_on_order) : 0,
    odooProductId: row.odoo_product_id,
    odooSyncedAt: row.odoo_synced_at ? new Date(String(row.odoo_synced_at)) : null,
    createdBy: row.created_by,
    createdAt: row.created_at ? new Date(String(row.created_at)) : null,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)) : null,
  };
}
