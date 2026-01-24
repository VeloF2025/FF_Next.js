/**
 * Odoo Stock Transfer Sync Service
 *
 * Syncs internal stock transfers (stock.picking with picking_type_code='internal')
 * from Odoo to FibreFlow stock_movements table
 *
 * Mapping:
 * - Odoo stock.picking (type=internal) → FF stock_movements (movement_type='transfer')
 * - Odoo stock.move → individual movement records
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { OdooClient, OdooStockPicking, OdooStockMove } from '../odooClient';

const logger = createLogger({ module: 'odooStockTransferSync' });

// ============================================================================
// Types
// ============================================================================

export interface StockTransferSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  details: Array<{
    odooPickingId: number;
    odooPickingName: string;
    action: 'created' | 'updated' | 'skipped' | 'error';
    movementsCreated?: number;
    message?: string;
  }>;
}

export interface StockTransferSyncOptions {
  dryRun?: boolean;
  sinceDate?: Date;
  limit?: number;
  skipExisting?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get stock item ID by Odoo product ID
 */
async function getStockItemByOdooId(
  sql: NeonQueryFunction<false, false>,
  odooProductId: number
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM stock_items WHERE odoo_product_id = ${odooProductId} LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Get FF location ID by Odoo location ID
 */
async function getLocationByOdooId(
  sql: NeonQueryFunction<false, false>,
  odooLocationId: number
): Promise<string | null> {
  // First check odoo_location_mappings
  const mappingRows = await sql<{ ff_location_id: string }[]>`
    SELECT ff_location_id FROM odoo_location_mappings
    WHERE odoo_location_id = ${odooLocationId}
    AND ff_location_id IS NOT NULL
    LIMIT 1
  `;
  if (mappingRows.length > 0) {
    return mappingRows[0].ff_location_id;
  }

  // Fallback: check stock_locations directly (if odoo_location_id column exists)
  try {
    const directRows = await sql<{ id: string }[]>`
      SELECT id FROM stock_locations
      WHERE odoo_location_id = ${odooLocationId}
      LIMIT 1
    `;
    return directRows.length > 0 ? directRows[0].id : null;
  } catch {
    return null;
  }
}

/**
 * Get default location (warehouse)
 */
async function getDefaultLocation(
  sql: NeonQueryFunction<false, false>
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM stock_locations
    WHERE location_type = 'warehouse'
    ORDER BY name ASC
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Check if a movement with this odoo_move_id exists
 */
async function getExistingMovement(
  sql: NeonQueryFunction<false, false>,
  odooMoveId: number
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM stock_movements WHERE odoo_move_id = ${odooMoveId} LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

// ============================================================================
// Main Sync Function
// ============================================================================

/**
 * Sync stock transfers from Odoo to FibreFlow
 */
export async function syncStockTransfers(
  client: OdooClient,
  databaseUrl: string,
  options: StockTransferSyncOptions = {}
): Promise<StockTransferSyncResult> {
  const sql = neon(databaseUrl);

  const result: StockTransferSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  const { dryRun = false, sinceDate, limit = 200, skipExisting = true } = options;

  try {
    logger.info('Starting stock transfer sync from Odoo', { dryRun, sinceDate, limit });

    // Get default location for fallback
    const defaultLocationId = await getDefaultLocation(sql);

    // Fetch completed internal transfers from Odoo
    const odooTransfers = await client.getCompletedTransfers({
      sinceDate,
      limit,
    });

    logger.info(`Found ${odooTransfers.length} internal transfers in Odoo`);

    // Process each transfer
    for (const transfer of odooTransfers) {
      try {
        // Get stock moves for this picking
        const moves = await client.getStockMovesForPickings([transfer.id]);

        if (moves.length === 0) {
          result.skipped++;
          result.details.push({
            odooPickingId: transfer.id,
            odooPickingName: transfer.name,
            action: 'skipped',
            message: 'No stock moves found',
          });
          continue;
        }

        // Check if transfer already synced
        const existingMoves = await Promise.all(
          moves.map((m) => getExistingMovement(sql, m.id))
        );
        const allExist = existingMoves.every((e) => e !== null);

        if (allExist && skipExisting) {
          result.skipped++;
          result.details.push({
            odooPickingId: transfer.id,
            odooPickingName: transfer.name,
            action: 'skipped',
            message: 'All moves already synced',
          });
          continue;
        }

        // Dry run - log what would happen
        if (dryRun) {
          result.created++;
          result.details.push({
            odooPickingId: transfer.id,
            odooPickingName: transfer.name,
            action: 'created',
            movementsCreated: moves.length,
            message: `Dry run - would create ${moves.length} movements`,
          });
          continue;
        }

        // Get locations for this transfer
        const fromLocationId = transfer.location_id
          ? await getLocationByOdooId(sql, transfer.location_id[0])
          : defaultLocationId;
        const toLocationId = transfer.location_dest_id
          ? await getLocationByOdooId(sql, transfer.location_dest_id[0])
          : defaultLocationId;

        // Process each move
        let movementsCreated = 0;
        for (const move of moves) {
          try {
            // Skip if already exists
            const existingId = await getExistingMovement(sql, move.id);
            if (existingId && skipExisting) {
              continue;
            }

            // Get stock item
            const stockItemId = move.product_id
              ? await getStockItemByOdooId(sql, move.product_id[0])
              : null;

            if (!stockItemId) {
              logger.warn(`Stock item not found for product ${move.product_id?.[1] || 'unknown'}`);
              continue;
            }

            // Get move-specific locations (may differ from picking)
            const moveFromLocation = move.location_id
              ? (await getLocationByOdooId(sql, move.location_id[0])) || fromLocationId
              : fromLocationId;
            const moveToLocation = move.location_dest_id
              ? (await getLocationByOdooId(sql, move.location_dest_id[0])) || toLocationId
              : toLocationId;

            if (existingId) {
              // Update existing movement
              await sql`
                UPDATE stock_movements
                SET
                  quantity = ${move.quantity},
                  from_location_id = ${moveFromLocation},
                  to_location_id = ${moveToLocation},
                  performed_at = ${move.date ? new Date(move.date) : new Date()},
                  odoo_synced_at = NOW()
                WHERE id = ${existingId}
              `;
              result.updated++;
            } else {
              // Create new movement
              await sql`
                INSERT INTO stock_movements (
                  stock_item_id,
                  movement_type,
                  from_location_id,
                  to_location_id,
                  quantity,
                  reference,
                  notes,
                  performed_by,
                  performed_at,
                  odoo_move_id,
                  odoo_picking_id,
                  source_type,
                  odoo_synced_at
                ) VALUES (
                  ${stockItemId},
                  'transfer',
                  ${moveFromLocation},
                  ${moveToLocation},
                  ${move.quantity},
                  ${transfer.name},
                  ${'Odoo internal transfer: ' + (move.reference || transfer.name)},
                  'odoo-sync',
                  ${move.date ? new Date(move.date) : new Date()},
                  ${move.id},
                  ${transfer.id},
                  'odoo_transfer',
                  NOW()
                )
              `;
              movementsCreated++;
            }
          } catch (moveError) {
            const msg = moveError instanceof Error ? moveError.message : 'Unknown error';
            logger.warn(`Error syncing move ${move.id}`, { error: msg });
          }
        }

        result.created++;
        result.details.push({
          odooPickingId: transfer.id,
          odooPickingName: transfer.name,
          action: movementsCreated > 0 ? 'created' : 'updated',
          movementsCreated,
        });
      } catch (transferError) {
        const message = transferError instanceof Error ? transferError.message : 'Unknown error';
        result.errors.push(`${transfer.name}: ${message}`);
        result.details.push({
          odooPickingId: transfer.id,
          odooPickingName: transfer.name,
          action: 'error',
          message,
        });
        logger.error(`Error syncing transfer ${transfer.name}`, { error: message });
      }
    }

    // Record sync timestamp
    if (!dryRun) {
      try {
        await sql`
          UPDATE odoo_api_config
          SET last_sync_stock_transfers = NOW()
          WHERE id = (SELECT id FROM odoo_api_config LIMIT 1)
        `;
      } catch {
        logger.debug('Could not update last_sync_stock_transfers');
      }

      try {
        await sql`
          INSERT INTO odoo_sync_history (
            entity_type, sync_type, records_processed, records_created,
            records_updated, records_failed, status, error_details, completed_at
          ) VALUES (
            'stock_transfer', 'full', ${odooTransfers.length}, ${result.created},
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

    logger.info('Stock transfer sync completed', {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Stock transfer sync failed', { error: message });
    result.errors.push(`Sync failed: ${message}`);
    return result;
  }
}

/**
 * Get stock transfer sync statistics
 */
export async function getStockTransferSyncStats(
  databaseUrl: string
): Promise<{
  totalMovements: number;
  odooSynced: number;
  byType: Array<{ type: string; count: number }>;
  lastSync: Date | null;
}> {
  const sql = neon(databaseUrl);

  const [totals, byType, lastSync] = await Promise.all([
    sql<Array<{ total: string; odoo_synced: string }>>`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE odoo_move_id IS NOT NULL) as odoo_synced
      FROM stock_movements
    `,
    sql<Array<{ movement_type: string; count: string }>>`
      SELECT movement_type, COUNT(*) as count
      FROM stock_movements
      GROUP BY movement_type
      ORDER BY count DESC
    `,
    sql<Array<{ last_sync: Date | null }>>`
      SELECT last_sync_stock_transfers as last_sync
      FROM odoo_api_config
      LIMIT 1
    `,
  ]);

  const stats = totals[0] || { total: '0', odoo_synced: '0' };

  return {
    totalMovements: parseInt(stats.total, 10),
    odooSynced: parseInt(stats.odoo_synced, 10),
    byType: byType.map((t) => ({
      type: t.movement_type,
      count: parseInt(t.count, 10),
    })),
    lastSync: lastSync[0]?.last_sync || null,
  };
}
