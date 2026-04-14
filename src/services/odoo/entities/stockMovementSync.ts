/**
 * Odoo Stock Movement Sync Service
 *
 * Syncs stock pickings and moves from Odoo to FibreFlow's stock_movements table.
 * This creates a unified movements table for both:
 * - Historical Odoo data (receipts, transfers, deliveries)
 * - FibreFlow-created movements (GRNs, issues, returns)
 */

import { createLogger } from '@/lib/logger';
import {
  OdooClient,
  OdooStockPicking,
  OdooStockMove,
  OdooStockLocation,
} from '../odooClient';
import type { Pool } from 'pg';

const logger = createLogger('odoo:stockMovementSync');

// ============================================================================
// Types
// ============================================================================

export interface StockMovementSyncResult {
  success: boolean;
  pickingsSynced: number;
  movesSynced: number;
  errors: string[];
  duration: number;
}

export interface SyncedPicking {
  odoo_picking_id: number;
  reference: string;
  movement_type: string;
  from_location: string;
  to_location: string;
  partner_name: string | null;
  state: string;
  scheduled_date: string;
  date_done: string | null;
  origin: string | null;
}

// ============================================================================
// Movement Type Mapping
// ============================================================================

/**
 * Map Odoo picking type code to FibreFlow movement type
 */
function mapMovementType(pickingTypeCode: string | null): string {
  switch (pickingTypeCode) {
    case 'incoming':
      return 'GRN'; // Goods Receipt Note (receipt from supplier)
    case 'outgoing':
      return 'DELIVERY'; // Delivery to customer/project
    case 'internal':
      return 'TRANSFER'; // Internal transfer between locations
    default:
      return 'OTHER';
  }
}

/**
 * Map Odoo state to FibreFlow status
 */
function mapStatus(odooState: string): string {
  switch (odooState) {
    case 'draft':
      return 'draft';
    case 'waiting':
    case 'confirmed':
    case 'assigned':
      return 'pending';
    case 'done':
      return 'completed';
    case 'cancel':
      return 'cancelled';
    default:
      return 'pending';
  }
}

// ============================================================================
// Sync Service
// ============================================================================

export class StockMovementSyncService {
  private pool: Pool;
  private odoo: OdooClient;
  private locationCache: Map<number, OdooStockLocation> = new Map();
  private pickingTypeCache: Map<number, string> = new Map();

  constructor(pool: Pool, odooClient: OdooClient) {
    this.pool = pool;
    this.odoo = odooClient;
  }

  /**
   * Load location cache for name lookups
   */
  private async loadLocationCache(): Promise<void> {
    if (this.locationCache.size > 0) return;

    const locations = await this.odoo.getStockLocations({ limit: 500 });
    for (const loc of locations) {
      this.locationCache.set(loc.id, loc);
    }
    logger.info('Loaded location cache', { count: locations.length });
  }

  /**
   * Load picking type cache for type code lookups
   */
  private async loadPickingTypeCache(): Promise<void> {
    if (this.pickingTypeCache.size > 0) return;

    const types = await this.odoo.searchRead<{ id: number; code: string }>(
      'stock.picking.type',
      { fields: ['id', 'code'], limit: 100 }
    );
    for (const t of types) {
      this.pickingTypeCache.set(t.id, t.code);
    }
    logger.info('Loaded picking type cache', { count: types.length });
  }

  /**
   * Get location name from cache
   */
  private getLocationName(locationId: [number, string] | false): string {
    if (!locationId) return 'Unknown';
    const loc = this.locationCache.get(locationId[0]);
    return loc?.complete_name || locationId[1] || 'Unknown';
  }

  /**
   * Get picking type code from cache
   */
  private getPickingTypeCode(pickingTypeId: [number, string] | false): string | null {
    if (!pickingTypeId) return null;
    return this.pickingTypeCache.get(pickingTypeId[0]) || null;
  }

  /**
   * Sync all completed stock pickings from Odoo
   */
  async syncCompletedPickings(options: {
    limit?: number;
    sinceDate?: string;
  } = {}): Promise<StockMovementSyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let pickingsSynced = 0;
    let movesSynced = 0;

    try {
      // Load caches
      await this.loadLocationCache();
      await this.loadPickingTypeCache();

      // Build domain for completed pickings
      const domain: unknown[] = [['state', '=', 'done']];
      if (options.sinceDate) {
        domain.push(['date_done', '>=', options.sinceDate]);
      }

      // Fetch pickings from Odoo
      const pickings = await this.odoo.getStockPickings({
        domain,
        limit: options.limit || 500,
        order: 'date_done DESC',
      });

      logger.info('Fetched pickings from Odoo', { count: pickings.length });

      // Get existing Odoo picking IDs to avoid duplicates
      const existingResult = await this.pool.query<{ odoo_picking_id: number }>(
        `SELECT DISTINCT odoo_picking_id FROM stock_movements WHERE odoo_picking_id IS NOT NULL`
      );
      const existingIds = new Set(existingResult.rows.map(r => r.odoo_picking_id));

      // Filter out already synced pickings
      const newPickings = pickings.filter(p => !existingIds.has(p.id));
      logger.info('New pickings to sync', { total: pickings.length, new: newPickings.length });

      // Process each picking
      for (const picking of newPickings) {
        try {
          const result = await this.syncPicking(picking);
          pickingsSynced++;
          movesSynced += result.moveCount;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Picking ${picking.name}: ${msg}`);
          logger.error('Error syncing picking', { pickingId: picking.id, name: picking.name, error: msg });
        }
      }

      logger.info('Stock movement sync complete', { pickingsSynced, movesSynced, errors: errors.length });

      return {
        success: errors.length === 0,
        pickingsSynced,
        movesSynced,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Stock movement sync failed', { error: msg });

      return {
        success: false,
        pickingsSynced,
        movesSynced,
        errors: [msg],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Sync a single picking and its moves
   */
  private async syncPicking(picking: OdooStockPicking): Promise<{ moveCount: number }> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Determine movement type
      const typeCode = this.getPickingTypeCode(picking.picking_type_id);
      const movementType = mapMovementType(typeCode);
      const status = mapStatus(picking.state);

      // Get location names
      const fromLocation = this.getLocationName(picking.location_id);
      const toLocation = this.getLocationName(picking.location_dest_id);

      // Extract partner name
      const partnerName = picking.partner_id ? picking.partner_id[1] : null;

      // Insert movement header
      const movementResult = await client.query<{ id: string }>(
        `INSERT INTO stock_movements (
          id, project_id, movement_type, reference_number, reference_type,
          from_location, to_location, status, movement_date, confirmed_at,
          notes, source_type, odoo_picking_id, odoo_synced_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12, NOW()
        ) RETURNING id`,
        [
          'odoo', // project_id placeholder - Odoo doesn't have FF project concept
          movementType,
          picking.name,
          typeCode || 'picking',
          fromLocation,
          toLocation,
          status,
          picking.scheduled_date,
          picking.date_done,
          `Synced from Odoo. Partner: ${partnerName || 'N/A'}. Origin: ${picking.origin || 'N/A'}`,
          'odoo',
          picking.id,
        ]
      );

      const movementId = movementResult.rows[0]?.id;
      if (!movementId) {
        throw new Error('Failed to insert movement');
      }

      // Fetch and sync move lines
      let moveCount = 0;
      if (picking.move_ids && picking.move_ids.length > 0) {
        const moves = await this.odoo.getStockMovesForPickings([picking.id]);

        for (const move of moves) {
          await this.syncMoveItem(client, movementId, move);
          moveCount++;
        }
      }

      await client.query('COMMIT');

      logger.debug('Synced picking', {
        pickingId: picking.id,
        name: picking.name,
        type: movementType,
        moveCount,
      });

      return { moveCount };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync a single stock move item
   */
  private async syncMoveItem(
    client: import('pg').PoolClient,
    movementId: string,
    move: OdooStockMove
  ): Promise<void> {
    const productName = move.product_id ? move.product_id[1] : 'Unknown Product';
    const productCode = move.product_id ? `odoo-${move.product_id[0]}` : '';
    const uom = move.product_uom ? move.product_uom[1] : 'EA';

    await client.query(
      `INSERT INTO stock_movement_items (
        id, stock_movement_id, project_id, item_code, description,
        planned_quantity, actual_quantity, uom, item_status, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4,
        $5, $6, $7, $8, NOW()
      )`,
      [
        movementId,
        'odoo',
        productCode,
        productName,
        move.product_uom_qty || 0,
        move.quantity || move.product_uom_qty || 0,
        uom,
        move.state === 'done' ? 'received' : 'pending',
      ]
    );
  }

  /**
   * Get sync status/statistics
   */
  async getSyncStatus(): Promise<{
    totalMovements: number;
    odooMovements: number;
    fibreflowMovements: number;
    lastSyncedAt: string | null;
    byType: Record<string, number>;
  }> {
    const totalResult = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM stock_movements'
    );
    const odooResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM stock_movements WHERE source_type = 'odoo'`
    );
    const lastSyncResult = await this.pool.query<{ max: string | null }>(
      `SELECT MAX(odoo_synced_at) as max FROM stock_movements WHERE source_type = 'odoo'`
    );
    const byTypeResult = await this.pool.query<{ movement_type: string; count: string }>(
      `SELECT movement_type, COUNT(*) FROM stock_movements GROUP BY movement_type`
    );

    const total = parseInt(totalResult.rows[0]?.count || '0', 10);
    const odoo = parseInt(odooResult.rows[0]?.count || '0', 10);

    const byType: Record<string, number> = {};
    for (const row of byTypeResult.rows) {
      byType[row.movement_type] = parseInt(row.count, 10);
    }

    return {
      totalMovements: total,
      odooMovements: odoo,
      fibreflowMovements: total - odoo,
      lastSyncedAt: lastSyncResult.rows[0]?.max || null,
      byType,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createStockMovementSyncService(
  pool: Pool,
  odooClient: OdooClient
): StockMovementSyncService {
  return new StockMovementSyncService(pool, odooClient);
}
