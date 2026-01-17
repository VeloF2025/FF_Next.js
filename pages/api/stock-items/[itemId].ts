/**
 * Stock Items API - Single Item CRUD
 *
 * GET    - Get single stock item
 * PUT    - Update stock item
 * DELETE - Delete stock item
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { itemId } = req.query;

  if (!itemId || typeof itemId !== 'string') {
    return res.status(400).json({ error: 'Invalid item ID' });
  }

  // GET - Get single stock item
  if (req.method === 'GET') {
    try {
      const [item] = await sql`
        SELECT * FROM stock_items WHERE id = ${itemId}
      `;

      if (!item) {
        return res.status(404).json({ error: 'Stock item not found' });
      }

      // Get supplier codes for this item
      const supplierCodes = await sql`
        SELECT
          sic.*,
          s.name as supplier_name
        FROM supplier_item_codes sic
        JOIN suppliers s ON s.id = sic.supplier_id
        WHERE sic.stock_item_id = ${itemId}
        ORDER BY sic.is_preferred DESC, s.name
      `;

      return res.status(200).json({
        data: {
          ...mapDbToStockItem(item),
          supplierCodes: supplierCodes.map(mapDbToSupplierCode),
        },
      });
    } catch (error) {
      console.error('Error fetching stock item:', error);
      return res.status(500).json({ error: 'Failed to fetch stock item' });
    }
  }

  // PUT - Update stock item
  if (req.method === 'PUT') {
    try {
      const body = req.body;

      const [existing] = await sql`SELECT id FROM stock_items WHERE id = ${itemId}`;
      if (!existing) {
        return res.status(404).json({ error: 'Stock item not found' });
      }

      // Check for duplicate item code if changing
      if (body.itemCode) {
        const [duplicate] = await sql`
          SELECT id FROM stock_items
          WHERE LOWER(item_code) = LOWER(${body.itemCode}) AND id != ${itemId}
        `;
        if (duplicate) {
          return res.status(409).json({ error: 'Item with this code already exists' });
        }
      }

      const [updated] = await sql`
        UPDATE stock_items
        SET
          item_code = COALESCE(${body.itemCode}, item_code),
          name = COALESCE(${body.name}, name),
          description = COALESCE(${body.description}, description),
          category = COALESCE(${body.category}, category),
          tracking_type = COALESCE(${body.trackingType}, tracking_type),
          uom = COALESCE(${body.uom}, uom),
          standard_cost = COALESCE(${body.standardCost}, standard_cost),
          list_price = COALESCE(${body.listPrice}, list_price),
          currency = COALESCE(${body.currency}, currency),
          min_stock_level = COALESCE(${body.minStockLevel}, min_stock_level),
          max_stock_level = COALESCE(${body.maxStockLevel}, max_stock_level),
          reorder_quantity = COALESCE(${body.reorderQuantity}, reorder_quantity),
          is_active = COALESCE(${body.isActive}, is_active),
          is_returnable = COALESCE(${body.isReturnable}, is_returnable),
          product_type = COALESCE(${body.productType}, product_type),
          purchase_ok = COALESCE(${body.purchaseOk}, purchase_ok),
          sale_ok = COALESCE(${body.saleOk}, sale_ok),
          qty_available = COALESCE(${body.qtyAvailable}, qty_available),
          qty_reserved = COALESCE(${body.qtyReserved}, qty_reserved),
          qty_on_order = COALESCE(${body.qtyOnOrder}, qty_on_order),
          updated_at = NOW()
        WHERE id = ${itemId}
        RETURNING *
      `;

      return res.status(200).json({ data: mapDbToStockItem(updated) });
    } catch (error: any) {
      console.error('Error updating stock item:', error);
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Item with this code already exists' });
      }
      return res.status(500).json({ error: 'Failed to update stock item' });
    }
  }

  // DELETE - Delete stock item
  if (req.method === 'DELETE') {
    try {
      const [existing] = await sql`SELECT id, odoo_product_id FROM stock_items WHERE id = ${itemId}`;
      if (!existing) {
        return res.status(404).json({ error: 'Stock item not found' });
      }

      // Warn if Odoo-synced item
      if (existing.odoo_product_id) {
        const { force } = req.query;
        if (force !== 'true') {
          return res.status(409).json({
            error: 'This item is synced from Odoo. Use ?force=true to delete anyway.',
            odooProductId: existing.odoo_product_id,
          });
        }
      }

      // Delete supplier codes first (cascade should handle this, but be explicit)
      await sql`DELETE FROM supplier_item_codes WHERE stock_item_id = ${itemId}`;

      // Delete the item
      await sql`DELETE FROM stock_items WHERE id = ${itemId}`;

      return res.status(200).json({ success: true, message: 'Stock item deleted successfully' });
    } catch (error) {
      console.error('Error deleting stock item:', error);
      return res.status(500).json({ error: 'Failed to delete stock item' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withArcjetProtection(handler, aj);

// Map database row to API response
function mapDbToStockItem(row: any) {
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
    odooSyncedAt: row.odoo_synced_at ? new Date(row.odoo_synced_at) : null,
    createdBy: row.created_by,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

function mapDbToSupplierCode(row: any) {
  return {
    id: row.id,
    stockItemId: row.stock_item_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierItemCode: row.supplier_item_code,
    supplierItemName: row.supplier_item_name,
    supplierPrice: row.supplier_price ? Number(row.supplier_price) : null,
    supplierCurrency: row.supplier_currency,
    priceValidFrom: row.price_valid_from,
    priceValidTo: row.price_valid_to,
    leadTimeDays: row.lead_time_days,
    minOrderQty: row.min_order_qty ? Number(row.min_order_qty) : null,
    isPreferred: row.is_preferred,
    isActive: row.is_active,
  };
}
