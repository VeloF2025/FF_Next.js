/**
 * Odoo Stock Level Sync Service
 *
 * Syncs stock.quant from Odoo to FibreFlow stock_levels table
 * Provides real-time inventory quantities by product and location
 *
 * Mapping:
 * - Odoo stock.quant → FF stock_levels
 * - Groups by product and location (aggregates multiple quants)
 */

import { neon, NeonQueryFunction } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { OdooClient } from '../odooClient';

const logger = createLogger('odooStockLevelSync');

// ============================================================================
// Types
// ============================================================================

export interface StockLevelSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  details: Array<{
    productId: number;
    productName: string;
    locationId: number;
    locationName: string;
    action: 'created' | 'updated' | 'skipped' | 'error';
    quantity?: number;
    message?: string;
  }>;
}

export interface StockLevelSyncOptions {
  dryRun?: boolean;
  productIds?: number[];  // Filter by specific products
  locationIds?: number[]; // Filter by specific locations
  limit?: number;
}

// ============================================================================
// Row Types
// ============================================================================

interface IdRow { id: string | number }
interface LocationMappingRow { ff_location_id: string | null; ff_warehouse_code: string | null }
interface StockLevelRow { id: string | number; qty_on_hand: number | string }
interface StatsRow { total: string; odoo_synced: string; total_qty: string }
interface WarehouseStatsRow { warehouse_name: string | null; count: string; total_qty: string }
interface LastSyncRow { last_sync: Date | null }
interface FfLevelRow { odoo_product_id: number; product_name: string | null; total_qty: string }

// ============================================================================
// Helper Functions
// ============================================================================

type SqlFn = NeonQueryFunction<false, false>;

/**
 * Get stock item ID by Odoo product ID
 */
async function getStockItemByOdooId(
  sql: SqlFn,
  odooProductId: number
): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM stock_items WHERE odoo_product_id = ${odooProductId} LIMIT 1
  ` as IdRow[];
  return rows.length > 0 ? String(rows[0]?.id ?? '') || null : null;
}

/**
 * Get warehouse ID by Odoo location ID
 * Tries odoo_location_mappings first, then direct match
 */
async function getWarehouseByOdooLocationId(
  sql: SqlFn,
  odooLocationId: number
): Promise<string | null> {
  // Try odoo_location_mappings first
  try {
    const mappingRows = await sql`
      SELECT ff_location_id, ff_warehouse_code FROM odoo_location_mappings
      WHERE odoo_location_id = ${odooLocationId}
      LIMIT 1
    ` as LocationMappingRow[];
    if (mappingRows.length > 0 && mappingRows[0]?.ff_location_id) {
      return String(mappingRows[0].ff_location_id) || null;
    }
    // If we have a warehouse code, look it up
    if (mappingRows.length > 0 && mappingRows[0]?.ff_warehouse_code) {
      const warehouseRows = await sql`
        SELECT id FROM stock_locations WHERE code = ${String(mappingRows[0].ff_warehouse_code)} LIMIT 1
      ` as IdRow[];
      return warehouseRows.length > 0 ? String(warehouseRows[0]?.id ?? '') || null : null;
    }
  } catch {
    // Table might not exist or have different structure
  }

  // Fallback: try warehouses table directly
  try {
    const directRows = await sql`
      SELECT id FROM stock_locations WHERE odoo_location_id = ${odooLocationId} LIMIT 1
    ` as IdRow[];
    return directRows.length > 0 ? String(directRows[0]?.id ?? '') || null : null;
  } catch {
    return null;
  }
}

/**
 * Get default warehouse
 */
async function getDefaultWarehouse(
  sql: SqlFn
): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM stock_locations
    ORDER BY name ASC
    LIMIT 1
  ` as IdRow[];
  return rows.length > 0 ? String(rows[0]?.id ?? '') || null : null;
}

/**
 * Get existing stock level by item and warehouse
 */
async function getExistingStockLevel(
  sql: SqlFn,
  stockItemId: string,
  warehouseId: string | null
): Promise<{ id: string; qty_on_hand: number } | null> {
  if (warehouseId) {
    const rows = await sql`
      SELECT id, qty_on_hand FROM stock_levels
      WHERE stock_item_id = ${stockItemId} AND location_id = ${warehouseId}
      LIMIT 1
    ` as StockLevelRow[];
    if (rows.length > 0 && rows[0]) {
      return { id: String(rows[0].id ?? ''), qty_on_hand: Number(rows[0].qty_on_hand ?? 0) };
    }
    return null;
  } else {
    const rows = await sql`
      SELECT id, qty_on_hand FROM stock_levels
      WHERE stock_item_id = ${stockItemId} AND location_id IS NULL
      LIMIT 1
    ` as StockLevelRow[];
    if (rows.length > 0 && rows[0]) {
      return { id: String(rows[0].id ?? ''), qty_on_hand: Number(rows[0].qty_on_hand ?? 0) };
    }
    return null;
  }
}

// ============================================================================
// Main Sync Function
// ============================================================================

/**
 * Sync stock levels from Odoo to FibreFlow
 */
export async function syncStockLevels(
  client: OdooClient,
  databaseUrl: string,
  options: StockLevelSyncOptions = {}
): Promise<StockLevelSyncResult> {
  const sql = neon(databaseUrl);

  const result: StockLevelSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  const { dryRun = false, productIds: _productIds, locationIds: _locationIds, limit = 1000 } = options;

  try {
    logger.info('Starting stock level sync from Odoo', { dryRun, limit });

    // Get default warehouse
    const defaultWarehouseId = await getDefaultWarehouse(sql);

    // Fetch internal stock quants from Odoo
    const odooQuants = await client.getInternalStockQuants({ limit });

    logger.info(`Found ${odooQuants.length} stock quants in Odoo`);

    // Group quants by product+location (Odoo can have multiple quants per product/location)
    const groupedQuants = new Map<string, {
      productId: number;
      productName: string;
      locationId: number;
      locationName: string;
      totalQuantity: number;
      totalReserved: number;
      quantIds: number[];
    }>();

    for (const quant of odooQuants) {
      const productId = quant.product_id?.[0] || 0;
      const locationId = quant.location_id?.[0] || 0;
      const key = `${productId}-${locationId}`;

      const existing = groupedQuants.get(key);
      if (existing) {
        existing.totalQuantity += quant.quantity || 0;
        existing.totalReserved += quant.reserved_quantity || 0;
        existing.quantIds.push(quant.id);
      } else {
        groupedQuants.set(key, {
          productId,
          productName: quant.product_id?.[1] || 'Unknown',
          locationId,
          locationName: quant.location_id?.[1] || 'Unknown',
          totalQuantity: quant.quantity || 0,
          totalReserved: quant.reserved_quantity || 0,
          quantIds: [quant.id],
        });
      }
    }

    logger.info(`Grouped into ${groupedQuants.size} unique product-location combinations`);

    // Process each group
    for (const [, group] of groupedQuants) {
      try {
        // Get FF stock item
        const stockItemId = await getStockItemByOdooId(sql, group.productId);
        if (!stockItemId) {
          result.skipped++;
          result.details.push({
            productId: group.productId,
            productName: group.productName,
            locationId: group.locationId,
            locationName: group.locationName,
            action: 'skipped',
            message: 'Product not found in FF',
          });
          continue;
        }

        // Get FF warehouse
        const warehouseId = await getWarehouseByOdooLocationId(sql, group.locationId) || defaultWarehouseId;

        // Dry run
        if (dryRun) {
          const existing = await getExistingStockLevel(sql, stockItemId, warehouseId);
          result.details.push({
            productId: group.productId,
            productName: group.productName,
            locationId: group.locationId,
            locationName: group.locationName,
            action: existing ? 'updated' : 'created',
            quantity: group.totalQuantity,
            message: `Dry run - would ${existing ? 'update' : 'create'} stock level`,
          });
          if (existing) {
            result.updated++;
          } else {
            result.created++;
          }
          continue;
        }

        // Check if stock level exists
        const existing = await getExistingStockLevel(sql, stockItemId, warehouseId);

        if (existing) {
          // Update existing stock level
          await sql`
            UPDATE stock_levels
            SET
              qty_on_hand = ${group.totalQuantity},
              qty_reserved = ${group.totalReserved},
              odoo_location_id = ${group.locationId},
              location_name = ${group.locationName},
              odoo_quant_id = ${group.quantIds[0]},
              odoo_synced_at = NOW(),
              last_odoo_sync = NOW(),
              updated_at = NOW()
            WHERE id = ${existing.id}
          `;
          result.updated++;
          result.details.push({
            productId: group.productId,
            productName: group.productName,
            locationId: group.locationId,
            locationName: group.locationName,
            action: 'updated',
            quantity: group.totalQuantity,
          });
        } else {
          // Create new stock level
          await sql`
            INSERT INTO stock_levels (
              stock_item_id,
              location_id,
              odoo_location_id,
              location_name,
              qty_on_hand,
              qty_reserved,
              odoo_quant_id,
              odoo_synced_at,
              last_odoo_sync,
              created_at,
              updated_at
            ) VALUES (
              ${stockItemId},
              ${warehouseId},
              ${group.locationId},
              ${group.locationName},
              ${group.totalQuantity},
              ${group.totalReserved},
              ${group.quantIds[0]},
              NOW(),
              NOW(),
              NOW(),
              NOW()
            )
          `;
          result.created++;
          result.details.push({
            productId: group.productId,
            productName: group.productName,
            locationId: group.locationId,
            locationName: group.locationName,
            action: 'created',
            quantity: group.totalQuantity,
          });
        }
      } catch (groupError) {
        const message = groupError instanceof Error ? groupError.message : 'Unknown error';
        result.errors.push(`${group.productName} @ ${group.locationName}: ${message}`);
        result.details.push({
          productId: group.productId,
          productName: group.productName,
          locationId: group.locationId,
          locationName: group.locationName,
          action: 'error',
          message,
        });
        logger.error(`Error syncing stock level for ${group.productName}`, { error: message });
      }
    }

    // Record sync timestamp
    if (!dryRun) {
      try {
        await sql`
          UPDATE odoo_api_config
          SET last_sync_stock_levels = NOW()
          WHERE id = (SELECT id FROM odoo_api_config LIMIT 1)
        `;
      } catch {
        logger.debug('Could not update last_sync_stock_levels');
      }

      try {
        await sql`
          INSERT INTO odoo_sync_history (
            entity_type, sync_type, records_processed, records_created,
            records_updated, records_failed, status, error_details, completed_at
          ) VALUES (
            'stock_level', 'full', ${groupedQuants.size}, ${result.created},
            ${result.updated}, ${result.errors.length},
            ${result.errors.length > 0 ? 'completed_with_errors' : 'completed'},
            ${result.errors.length > 0 ? JSON.stringify(result.errors) : null},
            CURRENT_TIMESTAMP
          )
        `;
      } catch {
        logger.debug('Could not record sync history');
      }
    }

    logger.info('Stock level sync completed', {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Stock level sync failed', { error: message });
    result.errors.push(`Sync failed: ${message}`);
    return result;
  }
}

/**
 * Sync stock level for a specific product
 */
export async function syncProductStockLevel(
  client: OdooClient,
  databaseUrl: string,
  odooProductId: number
): Promise<{ success: boolean; message: string; levels?: number }> {
  const result = await syncStockLevels(client, databaseUrl, {
    productIds: [odooProductId],
    limit: 100,
  });

  if (result.errors.length > 0) {
    return { success: false, message: result.errors[0] ?? 'Unknown error' };
  }

  return {
    success: true,
    message: `Synced ${result.created + result.updated} stock level(s)`,
    levels: result.created + result.updated,
  };
}

/**
 * Get stock level sync statistics
 */
export async function getStockLevelSyncStats(
  databaseUrl: string
): Promise<{
  totalLevels: number;
  odooSynced: number;
  totalQuantity: number;
  byWarehouse: Array<{ warehouseName: string | null; count: number; totalQty: number }>;
  lastSync: Date | null;
}> {
  const sql = neon(databaseUrl);

  const [rawTotals, rawByWarehouse, rawLastSync] = await Promise.all([
    sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE odoo_quant_id IS NOT NULL) as odoo_synced,
        COALESCE(SUM(qty_on_hand), 0) as total_qty
      FROM stock_levels
    `,
    sql`
      SELECT
        w.name as warehouse_name,
        COUNT(sl.*) as count,
        COALESCE(SUM(sl.qty_on_hand), 0) as total_qty
      FROM stock_levels sl
      LEFT JOIN stock_locations w ON sl.location_id = w.id
      GROUP BY w.id, w.name
      ORDER BY total_qty DESC
    `,
    sql`
      SELECT last_sync_stock_levels as last_sync
      FROM odoo_api_config
      LIMIT 1
    `,
  ]);
  const totals = rawTotals as StatsRow[];
  const byWarehouse = rawByWarehouse as WarehouseStatsRow[];
  const lastSync = rawLastSync as LastSyncRow[];

  const stats = totals[0] ?? { total: '0', odoo_synced: '0', total_qty: '0' };

  return {
    totalLevels: parseInt(stats.total, 10),
    odooSynced: parseInt(stats.odoo_synced, 10),
    totalQuantity: parseFloat(stats.total_qty),
    byWarehouse: byWarehouse.map((w) => ({
      warehouseName: w.warehouse_name,
      count: parseInt(w.count, 10),
      totalQty: parseFloat(w.total_qty),
    })),
    lastSync: lastSync[0]?.last_sync ?? null,
  };
}

/**
 * Compare Odoo vs FF stock levels for discrepancies
 */
export async function compareStockLevels(
  client: OdooClient,
  databaseUrl: string,
  options?: { limit?: number }
): Promise<{
  matches: number;
  discrepancies: Array<{
    productName: string;
    odooQty: number;
    ffQty: number;
    difference: number;
  }>;
}> {
  const sql = neon(databaseUrl);
  const limit = options?.limit || 500;

  // Get Odoo quants
  const odooQuants = await client.getInternalStockQuants({ limit });

  // Aggregate Odoo quantities by product
  const odooByProduct = new Map<number, { name: string; qty: number }>();
  for (const quant of odooQuants) {
    const productId = quant.product_id?.[0] || 0;
    const existing = odooByProduct.get(productId);
    if (existing) {
      existing.qty += quant.quantity || 0;
    } else {
      odooByProduct.set(productId, {
        name: quant.product_id?.[1] || 'Unknown',
        qty: quant.quantity || 0,
      });
    }
  }

  // Get FF stock levels grouped by product
  const ffLevels = await sql`
    SELECT
      si.odoo_product_id,
      si.name as product_name,
      COALESCE(SUM(sl.qty_on_hand), 0) as total_qty
    FROM stock_items si
    LEFT JOIN stock_levels sl ON sl.stock_item_id = si.id
    WHERE si.odoo_product_id IS NOT NULL
    GROUP BY si.id, si.odoo_product_id, si.name
  ` as FfLevelRow[];

  const ffByProduct = new Map(
    ffLevels.map((row) => [
      row.odoo_product_id,
      { name: row.product_name, qty: parseFloat(row.total_qty) },
    ])
  );

  // Compare
  let matches = 0;
  const discrepancies: Array<{
    productName: string;
    odooQty: number;
    ffQty: number;
    difference: number;
  }> = [];

  for (const [productId, odoo] of odooByProduct) {
    const ff = ffByProduct.get(productId);
    const ffQty = ff?.qty || 0;

    if (Math.abs(odoo.qty - ffQty) < 0.001) {
      matches++;
    } else {
      discrepancies.push({
        productName: odoo.name,
        odooQty: odoo.qty,
        ffQty,
        difference: odoo.qty - ffQty,
      });
    }
  }

  // Sort discrepancies by difference magnitude
  discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  return { matches, discrepancies };
}
