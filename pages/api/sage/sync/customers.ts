/**
 * Sage Customer Sync API
 *
 * POST - Pull customers from Sage and create/update mappings to FF clients
 * GET - Get customer sync status and mapping stats
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { getSageClientFromDb } from '@/services/sage/sageClient';
import {
  pullCustomersFromSage,
  manuallyMapCustomer,
} from '@/services/sage/entities/customerSync';

const logger = createLogger('api:sage:sync:customers');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    try {
      const lastSync = await sql`
        SELECT id, entity_type, status, records_processed, records_created,
               records_updated, records_failed, error_message, created_at, completed_at
        FROM sage_sync_history
        WHERE entity_type = 'customer'
        ORDER BY created_at DESC LIMIT 1
      `;

      const stats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE sync_status = 'synced') as synced,
          COUNT(*) FILTER (WHERE sync_status = 'pending_review') as pending_review,
          COUNT(*) as total
        FROM sage_entity_mappings
        WHERE sage_entity_type = 'customer'
      `;

      const unmapped = await sql`
        SELECT COUNT(*) as count FROM clients
        WHERE sage_customer_id IS NULL AND deleted_at IS NULL
      `;

      return apiResponse.success(res, {
        lastSync: lastSync[0] || null,
        mappingStats: {
          synced: parseInt(stats[0]?.synced as string || '0'),
          pendingReview: parseInt(stats[0]?.pending_review as string || '0'),
          total: parseInt(stats[0]?.total as string || '0'),
        },
        unmappedClients: parseInt(unmapped[0]?.count as string || '0'),
      });
    } catch (error) {
      logger.error('Failed to get customer sync status', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    const { action, sageId, clientId } = req.body;

    if (action === 'manual_map') {
      if (!sageId || !clientId) {
        return apiResponse.badRequest(res, 'sageId and clientId are required');
      }
      try {
        const success = await manuallyMapCustomer(sql, sageId, clientId);
        return success
          ? apiResponse.success(res, { message: 'Customer mapped successfully' })
          : apiResponse.badRequest(res, 'Failed to map customer');
      } catch (error) {
        logger.error('Manual customer mapping failed', { error });
        return apiResponse.internalError(res, error);
      }
    }

    try {
      const client = await getSageClientFromDb(sql);
      const result = await pullCustomersFromSage(client, sql);

      await sql`
        UPDATE sage_api_config SET last_sync_at = NOW(), updated_at = NOW()
        WHERE is_active = true
      `;

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Customer sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
