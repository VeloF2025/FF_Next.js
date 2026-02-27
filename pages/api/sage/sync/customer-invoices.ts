/**
 * Sage Customer Invoice Sync API
 *
 * POST - Pull customer invoices (Tax Invoices) from Sage
 * GET - Get sync status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { getSageClientFromDb } from '@/services/sage/sageClient';
import {
  pullCustomerInvoicesFromSage,
} from '@/services/sage/entities/customerInvoiceSync';

const logger = createLogger('api:sage:sync:customer-invoices');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    try {
      const lastSync = await sql`
        SELECT * FROM sage_sync_history
        WHERE entity_type = 'customer_invoice'
        ORDER BY created_at DESC LIMIT 1
      `;

      const stats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE migration_status = 'imported') as imported,
          COUNT(*) FILTER (WHERE migration_status = 'pending') as pending,
          COUNT(*) FILTER (WHERE migration_status = 'failed') as failed,
          COUNT(*) as total,
          COALESCE(SUM(total_amount), 0) as total_amount
        FROM sage_customer_invoices
      `;

      return apiResponse.success(res, {
        lastSync: lastSync[0] || null,
        stats: {
          imported: parseInt(stats[0]?.imported as string || '0'),
          pending: parseInt(stats[0]?.pending as string || '0'),
          failed: parseInt(stats[0]?.failed as string || '0'),
          total: parseInt(stats[0]?.total as string || '0'),
          totalAmount: parseFloat(stats[0]?.total_amount as string || '0'),
        },
      });
    } catch (error) {
      logger.error('Failed to get customer invoice sync status', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    const { sinceDate } = req.body || {};

    try {
      const client = await getSageClientFromDb(sql);
      const result = await pullCustomerInvoicesFromSage(client, sql, {
        sinceDate: sinceDate ? new Date(sinceDate) : undefined,
      });

      await sql`
        UPDATE sage_api_config SET last_sync_at = NOW(), updated_at = NOW()
        WHERE is_active = true
      `;

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Customer invoice sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
