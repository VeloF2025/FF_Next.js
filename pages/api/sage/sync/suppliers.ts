/**
 * Sage Supplier Sync API
 *
 * POST - Pull suppliers from Sage and create/update mappings
 * GET - Get sync status and unmatched suppliers
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { getSageClientFromDb } from '@/services/sage/sageClient';
import {
  pullSuppliersFromSage,
  getUnmatchedSuppliers,
  manuallyMapSupplier,
} from '@/services/sage/entities/supplierSync';

const logger = createLogger('api:sage:sync:suppliers');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  // GET - Get sync status
  if (req.method === 'GET') {
    try {
      // Get last sync info
      const lastSync = await sql`
        SELECT *
        FROM sage_sync_history
        WHERE entity_type = 'supplier'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      // Get mapping stats
      const stats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE sync_status = 'synced') as synced,
          COUNT(*) FILTER (WHERE sync_status = 'pending_review') as pending_review,
          COUNT(*) FILTER (WHERE sync_status = 'failed') as failed,
          COUNT(*) as total
        FROM sage_entity_mappings
        WHERE sage_entity_type = 'supplier'
      `;

      // Get FF suppliers without mapping
      const unmapped = await sql`
        SELECT COUNT(*) as count
        FROM suppliers
        WHERE sage_supplier_id IS NULL
      `;

      return apiResponse.success(res, {
        lastSync: lastSync[0] || null,
        mappingStats: {
          synced: parseInt(stats[0]?.synced as string || '0'),
          pendingReview: parseInt(stats[0]?.pending_review as string || '0'),
          failed: parseInt(stats[0]?.failed as string || '0'),
          total: parseInt(stats[0]?.total as string || '0'),
        },
        unmappedFFSuppliers: parseInt(unmapped[0]?.count as string || '0'),
      });
    } catch (error) {
      logger.error('Failed to get supplier sync status', { error });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Trigger supplier sync
  if (req.method === 'POST') {
    const { action, sageId, ffSupplierId } = req.body;

    // Manual mapping action
    if (action === 'manual_map') {
      if (!sageId || !ffSupplierId) {
        return apiResponse.badRequest(res, 'sageId and ffSupplierId are required');
      }

      try {
        const success = await manuallyMapSupplier(sql, sageId, ffSupplierId);
        if (success) {
          return apiResponse.success(res, { message: 'Supplier mapped successfully' });
        } else {
          return apiResponse.badRequest(res, 'Failed to map supplier');
        }
      } catch (error) {
        logger.error('Manual mapping failed', { error });
        return apiResponse.internalError(res, error);
      }
    }

    // Default: Pull suppliers from Sage
    try {
      const client = await getSageClientFromDb(sql);
      const result = await pullSuppliersFromSage(client, sql);

      // Update last_sync_at
      await sql`
        UPDATE sage_api_config
        SET last_sync_at = NOW(), updated_at = NOW()
        WHERE is_active = true
      `;

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Supplier sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
