/**
 * Odoo Stock Receipt (GRN) Sync Service
 *
 * Syncs stock.picking (incoming) from Odoo to FibreFlow goods_receipt_notes
 * with corresponding stock.move lines to goods_receipt_items
 *
 * Mapping:
 * - Odoo stock.picking (picking_type_code='incoming') → FF goods_receipt_notes
 * - Odoo stock.move → FF goods_receipt_items
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { OdooClient } from '../odooClient';

const logger = createLogger('odooStockReceiptSync');

// ============================================================================
// Types
// ============================================================================

export interface StockReceiptSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  details: Array<{
    odooId: number;
    odooName: string;
    action: 'created' | 'updated' | 'skipped' | 'error';
    grnId?: string;
    grnNumber?: string;
    itemsCreated?: number;
    message?: string;
  }>;
}

export interface StockReceiptSyncOptions {
  dryRun?: boolean;
  sinceDate?: Date;
  limit?: number;
  skipExisting?: boolean;
}

// Odoo state to FF status mapping
const STATE_MAPPING: Record<string, string> = {
  draft: 'draft',
  waiting: 'draft',
  confirmed: 'draft',
  assigned: 'receiving',
  done: 'completed',
  cancel: 'cancelled',
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get supplier ID by Odoo partner ID
 */
async function getSupplierByOdooId(
  sql: any,
  odooPartnerId: number
): Promise<number | null> {
  const rows = await sql`
    SELECT id FROM suppliers WHERE odoo_partner_id = ${odooPartnerId} LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Get PO ID by Odoo PO ID
 */
async function getPurchaseOrderByOdooId(
  sql: any,
  odooPOId: number
): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM purchase_orders WHERE odoo_po_id = ${odooPOId} LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Get stock item ID by Odoo product ID
 */
async function getStockItemByOdooId(
  sql: any,
  odooProductId: number
): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM stock_items WHERE odoo_product_id = ${odooProductId} LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Get warehouse ID (default or first available)
 */
async function getDefaultWarehouseId(
  sql: any
): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM stock_locations
    WHERE location_type = 'warehouse'
    ORDER BY name ASC
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Get existing GRN by Odoo picking ID
 */
async function getExistingGRN(
  sql: any,
  odooPickingId: number
): Promise<{ id: string; grn_number: string } | null> {
  const rows = await sql`
    SELECT id, grn_number FROM goods_receipt_notes
    WHERE odoo_picking_id = ${odooPickingId}
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Extract PO ID from picking origin field
 * Origin format: "PO00001" or sometimes "purchase.order:123"
 */
async function extractPOFromOrigin(
  sql: any,
  client: OdooClient,
  origin: string | null | false
): Promise<string | null> {
  if (!origin) return null;

  // Try direct PO lookup first
  if (origin.startsWith('PO')) {
    // This is a PO number - find by Odoo name
    const odooPos = await client.getPurchaseOrders({ limit: 1 });
    const matchingPo = odooPos.find((po) => po.name === origin);
    if (matchingPo) {
      return getPurchaseOrderByOdooId(sql, matchingPo.id);
    }
  }

  return null;
}

// ============================================================================
// Main Sync Function
// ============================================================================

/**
 * Sync stock receipts from Odoo to FibreFlow
 */
export async function syncStockReceipts(
  client: OdooClient,
  databaseUrl: string,
  options: StockReceiptSyncOptions = {}
): Promise<StockReceiptSyncResult> {
  const sql = neon(databaseUrl);

  const result: StockReceiptSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  const { dryRun = false, sinceDate, limit = 200, skipExisting = false } = options;

  try {
    logger.info('Starting stock receipt sync from Odoo', { dryRun, sinceDate, limit });

    // Get default warehouse
    const defaultWarehouseId = await getDefaultWarehouseId(sql);
    if (!defaultWarehouseId && !dryRun) {
      throw new Error('No warehouse found in stock_locations. Please create a warehouse first.');
    }

    // Fetch completed receipts from Odoo
    const odooReceipts = await client.getCompletedReceipts({
      sinceDate,
      limit,
    } as any);

    logger.info(`Found ${odooReceipts.length} receipts in Odoo`);

    // Get existing synced receipts to check for updates/skips
    const existingSynced = await sql`
      SELECT odoo_picking_id, id FROM goods_receipt_notes
      WHERE odoo_picking_id IS NOT NULL
    `;
    const existingMap = new Map(
      existingSynced.map((e) => [e.odoo_picking_id, e.id])
    );

    // Process each receipt
    for (const receipt of odooReceipts) {
      try {
        const existingId = existingMap.get(receipt.id);

        // Skip if already synced and skipExisting is true
        if (existingId && skipExisting) {
          result.skipped++;
          result.details.push({
            odooId: receipt.id,
            odooName: receipt.name,
            action: 'skipped',
            message: 'Already synced',
          });
          continue;
        }

        // Get supplier
        const supplierId = receipt.partner_id
          ? await getSupplierByOdooId(sql, receipt.partner_id[0])
          : null;

        if (!supplierId && !dryRun) {
          result.errors.push(`${receipt.name}: Supplier not found in FF (Odoo partner: ${(receipt.partner_id as any)?.[1] || 'unknown'})`);
          result.details.push({
            odooId: receipt.id,
            odooName: receipt.name,
            action: 'error',
            message: 'Supplier not found',
          });
          continue;
        }

        // Get PO link if available
        const poId = await extractPOFromOrigin(sql, client, receipt.origin);

        // Map status
        const ffStatus = STATE_MAPPING[receipt.state] || 'draft';

        // Fetch stock moves for this picking
        const moves = await client.getStockMovesForPickings([receipt.id]);

        // Dry run - just log what would happen
        if (dryRun) {
          result.details.push({
            odooId: receipt.id,
            odooName: receipt.name,
            action: existingId ? 'updated' : 'created',
            itemsCreated: moves.length,
            message: `Dry run - would ${existingId ? 'update' : 'create'} with ${moves.length} items`,
          });
          if (existingId) {
            result.updated++;
          } else {
            result.created++;
          }
          continue;
        }

        // Create or update GRN
        let grnId: string;
        let grnNumber: string;

        if (existingId) {
          // Update existing GRN
          const existing = await getExistingGRN(sql, receipt.id);
          if (!existing) {
            result.errors.push(`${receipt.name}: Could not find existing GRN`);
            continue;
          }

          grnId = existing.id;
          grnNumber = existing.grn_number;

          await sql`
            UPDATE goods_receipt_notes
            SET
              status = ${ffStatus},
              delivery_date = ${receipt.date_done ? new Date(receipt.date_done) : null},
              delivery_note_number = ${receipt.origin || null},
              updated_at = NOW()
            WHERE id = ${grnId}
          `;

          result.updated++;
          logger.debug(`Updated GRN: ${grnNumber}`, { odooId: receipt.id });
        } else {
          // Create new GRN
          const insertResult = await sql`
            INSERT INTO goods_receipt_notes (
              purchase_order_id,
              supplier_id,
              warehouse_id,
              status,
              delivery_date,
              delivery_note_number,
              received_by,
              received_by_name,
              odoo_picking_id,
              odoo_synced_at,
              notes,
              created_at
            ) VALUES (
              ${poId},
              ${supplierId!},
              ${defaultWarehouseId!},
              ${ffStatus},
              ${receipt.date_done ? new Date(receipt.date_done) : new Date()},
              ${receipt.origin || null},
              'odoo-sync',
              'Odoo Sync',
              ${receipt.id},
              NOW(),
              ${'Synced from Odoo: ' + receipt.name},
              ${(receipt as any).create_date ? new Date((receipt as any).create_date) : new Date()}
            )
            RETURNING id, grn_number
          `;

          grnId = insertResult[0]!.id;
          grnNumber = insertResult[0]!.grn_number;

          result.created++;
          logger.debug(`Created GRN: ${grnNumber}`, { odooId: receipt.id });
        }

        // Sync line items (stock.move)
        let itemsCreated = 0;
        for (const move of moves) {
          try {
            // Get stock item
            const stockItemId = move.product_id
              ? await getStockItemByOdooId(sql, move.product_id[0])
              : null;

            // Check if move already synced
            const existingItem = await sql`
              SELECT id FROM goods_receipt_items
              WHERE grn_id = ${grnId} AND odoo_move_id = ${move.id}
              LIMIT 1
            `;

            if (existingItem.length > 0) {
              // Update existing item
              await sql`
                UPDATE goods_receipt_items
                SET
                  quantity_expected = ${move.product_uom_qty},
                  quantity_received = ${move.quantity},
                  odoo_synced_at = NOW()
                WHERE id = ${existingItem[0]!.id}
              `;
            } else {
              // Create new item
              await sql`
                INSERT INTO goods_receipt_items (
                  grn_id,
                  stock_item_id,
                  item_code,
                  item_description,
                  quantity_expected,
                  quantity_received,
                  quantity_rejected,
                  uom,
                  lot_number,
                  odoo_move_id,
                  odoo_lot_id,
                  odoo_synced_at
                ) VALUES (
                  ${grnId},
                  ${stockItemId},
                  ${move.product_id ? (move.product_id as any)[1].split(']')[0].replace('[', '') : null},
                  ${move.product_id ? (move.product_id as any)[1] : 'Unknown Product'},
                  ${move.product_uom_qty},
                  ${move.quantity},
                  0,
                  ${move.product_uom ? (move.product_uom as any)[1] : 'unit'},
                  ${move.lot_ids ? (move.lot_ids as any)[1] : null},
                  ${move.id},
                  ${move.lot_ids ? (move.lot_ids as any)[0] : null},
                  NOW()
                )
              `;
              itemsCreated++;
            }
          } catch (moveError) {
            const msg = moveError instanceof Error ? moveError.message : 'Unknown error';
            logger.warn(`Error syncing move ${move.id} for ${receipt.name}`, { error: msg });
          }
        }

        result.details.push({
          odooId: receipt.id,
          odooName: receipt.name,
          action: existingId ? 'updated' : 'created',
          grnId,
          grnNumber,
          itemsCreated,
        });
      } catch (receiptError) {
        const message = receiptError instanceof Error ? receiptError.message : 'Unknown error';
        result.errors.push(`${receipt.name}: ${message}`);
        result.details.push({
          odooId: receipt.id,
          odooName: receipt.name,
          action: 'error',
          message,
        });
        logger.error(`Error syncing receipt ${receipt.name}`, { error: message });
      }
    }

    // Record sync in history
    if (!dryRun) {
      try {
        await sql`
          UPDATE odoo_api_config
          SET last_sync_stock_receipts = NOW()
          WHERE id = (SELECT id FROM odoo_api_config LIMIT 1)
        `;
      } catch {
        logger.debug('Could not update last_sync_stock_receipts');
      }

      try {
        await sql`
          INSERT INTO odoo_sync_history (
            entity_type, sync_type, records_processed, records_created,
            records_updated, records_failed, status, error_details, completed_at
          ) VALUES (
            'stock_receipt', 'full', ${odooReceipts.length}, ${result.created},
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

    logger.info('Stock receipt sync completed', {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Stock receipt sync failed', { error: message });
    result.errors.push(`Sync failed: ${message}`);
    return result;
  }
}

/**
 * Sync a single receipt by Odoo picking ID
 */
export async function syncSingleReceipt(
  client: OdooClient,
  databaseUrl: string,
  odooPickingId: number
): Promise<{ success: boolean; message: string; grnId?: string }> {
  try {
    // Get the specific picking
    const pickings = await client.getStockPickingsByType('incoming', { limit: 1 });
    const picking = pickings.find((p) => p.id === odooPickingId);

    if (!picking) {
      return { success: false, message: 'Picking not found in Odoo' };
    }

    const result = await syncStockReceipts(client, databaseUrl, {
      limit: 1,
      skipExisting: false,
    });

    if (result.errors.length > 0) {
      return { success: false, message: result.errors[0] ?? 'Unknown error' };
    }

    const detail = result.details.find((d) => d.odooId === odooPickingId);
    return {
      success: true,
      message: `GRN ${detail?.action || 'synced'}`,
      grnId: detail?.grnId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message };
  }
}

/**
 * Get stock receipt sync statistics
 */
export async function getStockReceiptSyncStats(
  databaseUrl: string
): Promise<{
  totalGRNs: number;
  odooSynced: number;
  notSynced: number;
  byStatus: Array<{ status: string; count: number }>;
  lastSync: Date | null;
}> {
  const sql = neon(databaseUrl);

  const [totals, byStatus, lastSync] = await Promise.all([
    sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE odoo_picking_id IS NOT NULL) as odoo_synced,
        COUNT(*) FILTER (WHERE odoo_picking_id IS NULL) as not_synced
      FROM goods_receipt_notes
    `,
    sql`
      SELECT status, COUNT(*) as count
      FROM goods_receipt_notes
      GROUP BY status
      ORDER BY count DESC
    `,
    sql`
      SELECT last_sync_stock_receipts as last_sync
      FROM odoo_api_config
      LIMIT 1
    `,
  ]);

  const stats = totals[0] || { total: '0', odoo_synced: '0', not_synced: '0' };

  return {
    totalGRNs: parseInt(stats.total, 10),
    odooSynced: parseInt(stats.odoo_synced, 10),
    notSynced: parseInt(stats.not_synced, 10),
    byStatus: byStatus.map((s) => ({
      status: s.status,
      count: parseInt(s.count, 10),
    })),
    lastSync: lastSync[0]?.last_sync || null,
  };
}
