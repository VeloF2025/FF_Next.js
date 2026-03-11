/**
 * Odoo Product Sync Service
 *
 * Syncs products from Odoo to FibreFlow stock_items
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { OdooClient } from '../odooClient';

const logger = createLogger('odooProductSync');

// ============================================================================
// Types
// ============================================================================

export interface OdooProduct {
  id: number;
  name: string;
  default_code: string | false;
  type: string;
  categ_id: [number, string] | false;
  uom_id: [number, string] | false;
  list_price: number;
  standard_price: number;
  qty_available: number;
  virtual_available: number;
  purchase_ok: boolean;
  sale_ok: boolean;
}

export interface ProductSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  details: Array<{
    odooId: number;
    itemCode: string;
    action: 'created' | 'updated' | 'skipped' | 'error';
    message?: string;
  }>;
}

// ============================================================================
// Category Mapping
// ============================================================================

// Map Odoo categories to FF stock_items categories
const CATEGORY_MAP: Record<string, string> = {
  'Activations': 'activations',
  'Backhaul': 'backhaul',
  'Optical': 'optical',
  'Poles': 'poles',
  'Stringing': 'stringing',
  'FiberTime': 'fibertime',
  'Tools': 'tools',
  'Services': 'services',
  'Goods': 'goods',
  'Expenses': 'expenses',
  'BOQ Tembelihle': 'boq',
};

// Map Odoo product type to tracking type
function getTrackingType(category: string, productType: string): string {
  if (productType === 'service') return 'none';

  // Serial tracked items
  const serialTracked = ['ont', 'router', 'tools', 'fibertime'];
  if (serialTracked.some(c => category.includes(c))) return 'serial';

  // Lot tracked (cables, etc.)
  const lotTracked = ['stringing', 'backhaul'];
  if (lotTracked.some(c => category.includes(c))) return 'lot';

  // Default to quantity tracking
  return 'quantity';
}

// ============================================================================
// Mapping Function
// ============================================================================

function mapOdooProductToFF(product: OdooProduct) {
  // Use product name as item code (Odoo uses name as the code)
  const itemCode = product.name;

  // Get category
  const odooCategory = product.categ_id ? product.categ_id[1] : 'Uncategorized';
  const category = CATEGORY_MAP[odooCategory] || odooCategory.toLowerCase().replace(/\s+/g, '_');

  // Get UOM
  const uom = product.uom_id ? product.uom_id[1] : 'EA';

  // Get tracking type
  const trackingType = getTrackingType(category, product.type);

  return {
    odoo_product_id: product.id,
    item_code: itemCode,
    name: itemCode, // Same as item_code for Odoo products
    description: product.default_code && product.default_code !== 'N/A'
      ? product.default_code
      : null,
    category,
    tracking_type: trackingType,
    uom,
    standard_cost: product.standard_price || null,
    list_price: product.list_price || null,
    qty_available: product.qty_available || 0,
    product_type: product.type,
    purchase_ok: product.purchase_ok,
    sale_ok: product.sale_ok,
  };
}

// ============================================================================
// Sync Function
// ============================================================================

/**
 * Sync products from Odoo to FibreFlow stock_items
 */
export async function syncProducts(
  client: OdooClient,
  databaseUrl: string,
  options?: { dryRun?: boolean; onlyWithStock?: boolean }
): Promise<ProductSyncResult> {
  const sql = neon(databaseUrl);
  const result: ProductSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  try {
    logger.info('Starting product sync from Odoo');

    // Fetch ALL products from Odoo
    const odooProducts = await client.searchRead<OdooProduct>('product.product', {
      fields: [
        'id', 'name', 'default_code', 'type', 'categ_id', 'uom_id',
        'list_price', 'standard_price', 'qty_available', 'virtual_available',
        'purchase_ok', 'sale_ok',
      ],
      limit: 1000,
    });

    logger.info(`Found ${odooProducts.length} products in Odoo`);

    // Filter if onlyWithStock
    const products = options?.onlyWithStock
      ? odooProducts.filter(p => p.qty_available > 0)
      : odooProducts;

    logger.info(`Processing ${products.length} products`);

    // Get existing stock items with Odoo IDs
    const existingItems = await sql`
      SELECT id, odoo_product_id FROM stock_items WHERE odoo_product_id IS NOT NULL
    `;
    const existingByOdooId = new Map(
      existingItems.map(item => [item.odoo_product_id, item.id])
    );

    // Also check for existing items by item_code (in case already imported)
    const existingByCode = await sql`
      SELECT id, item_code FROM stock_items
    `;
    const codeToId = new Map(
      existingByCode.map(item => [item.item_code.toLowerCase(), item.id])
    );

    for (const product of products) {
      try {
        const ffData = mapOdooProductToFF(product);
        const existingId = existingByOdooId.get(product.id);
        const existingByCodeId = codeToId.get(ffData.item_code.toLowerCase());

        if (options?.dryRun) {
          result.details.push({
            odooId: product.id,
            itemCode: ffData.item_code,
            action: existingId || existingByCodeId ? 'updated' : 'created',
            message: 'Dry run',
          });
          if (existingId || existingByCodeId) {
            result.updated++;
          } else {
            result.created++;
          }
          continue;
        }

        if (existingId) {
          // Update existing by Odoo ID
          await sql`
            UPDATE stock_items
            SET
              item_code = ${ffData.item_code},
              name = ${ffData.name},
              description = ${ffData.description},
              category = ${ffData.category},
              tracking_type = ${ffData.tracking_type},
              uom = ${ffData.uom},
              standard_cost = ${ffData.standard_cost},
              list_price = ${ffData.list_price},
              qty_available = ${ffData.qty_available},
              product_type = ${ffData.product_type},
              purchase_ok = ${ffData.purchase_ok},
              sale_ok = ${ffData.sale_ok},
              odoo_synced_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${existingId}
          `;
          result.updated++;
          result.details.push({
            odooId: product.id,
            itemCode: ffData.item_code,
            action: 'updated',
          });
        } else if (existingByCodeId) {
          // Link existing item by code to Odoo
          await sql`
            UPDATE stock_items
            SET
              odoo_product_id = ${ffData.odoo_product_id},
              description = ${ffData.description},
              standard_cost = ${ffData.standard_cost},
              list_price = ${ffData.list_price},
              qty_available = ${ffData.qty_available},
              product_type = ${ffData.product_type},
              purchase_ok = ${ffData.purchase_ok},
              sale_ok = ${ffData.sale_ok},
              odoo_synced_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${existingByCodeId}
          `;
          result.updated++;
          result.details.push({
            odooId: product.id,
            itemCode: ffData.item_code,
            action: 'updated',
            message: 'Linked existing item',
          });
        } else {
          // Create new stock item
          await sql`
            INSERT INTO stock_items (
              odoo_product_id, item_code, name, description, category,
              tracking_type, uom, standard_cost, list_price, qty_available,
              product_type, purchase_ok, sale_ok, is_active,
              created_by, odoo_synced_at, created_at, updated_at
            ) VALUES (
              ${ffData.odoo_product_id}, ${ffData.item_code}, ${ffData.name},
              ${ffData.description}, ${ffData.category}, ${ffData.tracking_type},
              ${ffData.uom}, ${ffData.standard_cost}, ${ffData.list_price},
              ${ffData.qty_available}, ${ffData.product_type}, ${ffData.purchase_ok},
              ${ffData.sale_ok}, TRUE, 'odoo-sync', CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
          `;
          result.created++;
          result.details.push({
            odooId: product.id,
            itemCode: ffData.item_code,
            action: 'created',
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`${product.name}: ${message}`);
        result.details.push({
          odooId: product.id,
          itemCode: product.name,
          action: 'error',
          message,
        });
      }
    }

    logger.info('Product sync completed', {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Product sync failed', { error: message });
    result.errors.push(`Sync failed: ${message}`);
    return result;
  }
}
