/**
 * Odoo Stock Movements Sync API
 *
 * POST /api/odoo/sync/stock-movements - Trigger sync from Odoo
 * GET  /api/odoo/sync/stock-movements - Get sync status
 *
 * Syncs stock pickings (receipts, transfers, deliveries) from Odoo
 * to FibreFlow's unified stock_movements table.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { createOdooClient } from '@/services/odoo/odooClient';
import { createStockMovementSyncService } from '@/services/odoo/entities/stockMovementSync';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // GET - Return sync status
  if (req.method === 'GET') {
    try {
      const odooClient = createOdooClient();
      const syncService = createStockMovementSyncService(pool, odooClient);

      const status = await syncService.getSyncStatus();

      // Also get Odoo counts for comparison
      await odooClient.authenticate();
      const odooPickingCount = await odooClient.searchCount('stock.picking', [['state', '=', 'done']]);

      return apiResponse.success(res, {
        fibreflow: status,
        odoo: {
          completedPickings: odooPickingCount,
        },
        syncedPercentage: odooPickingCount > 0
          ? Math.round((status.odooMovements / odooPickingCount) * 100)
          : 0,
      });
    } catch (error) {
      log.error('Failed to get stock movement sync status', { error, module: 'odoo:sync:stock-movements' });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Trigger sync
  if (req.method === 'POST') {
    try {
      const { limit = 200, sinceDate } = req.body;

      log.info('Starting Odoo stock movements sync', {
        limit,
        sinceDate,
        module: 'odoo:sync:stock-movements',
      });

      const odooClient = createOdooClient();
      const syncService = createStockMovementSyncService(pool, odooClient);

      // Run sync
      const result = await syncService.syncCompletedPickings({
        limit: Math.min(limit, 500), // Cap at 500 per sync
        sinceDate,
      });

      if (result.success) {
        log.info('Odoo stock movements sync completed', {
          pickingsSynced: result.pickingsSynced,
          movesSynced: result.movesSynced,
          duration: result.duration,
          module: 'odoo:sync:stock-movements',
        });
      } else {
        log.warn('Odoo stock movements sync completed with errors', {
          pickingsSynced: result.pickingsSynced,
          movesSynced: result.movesSynced,
          errors: result.errors.length,
          module: 'odoo:sync:stock-movements',
        });
      }

      return apiResponse.success(res, {
        message: result.success
          ? 'Stock movements sync completed successfully'
          : 'Stock movements sync completed with some errors',
        ...result,
      });
    } catch (error) {
      log.error('Stock movements sync failed', { error, module: 'odoo:sync:stock-movements' });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
