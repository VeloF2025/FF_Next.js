/**
 * Sage Payment Sync API
 *
 * POST - Pull payments from Sage
 * GET - Get sync status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { getSageClientFromDb } from '@/services/sage/sageClient';
import { pullPaymentsFromSage, getPOPaymentSummary } from '@/services/sage/entities/paymentSync';

const logger = createLogger('api:sage:sync:payments');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  // GET - Get sync status
  if (req.method === 'GET') {
    const { poId } = req.query;

    try {
      // If poId provided, return payment summary for that PO
      if (poId && typeof poId === 'string') {
        const summary = await getPOPaymentSummary(sql, poId);
        return apiResponse.success(res, summary);
      }

      // Get last sync info
      const lastSync = await sql`
        SELECT *
        FROM sage_sync_history
        WHERE entity_type = 'supplier_payment'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      // Get payment stats
      const stats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE match_status = 'matched') as matched,
          COUNT(*) FILTER (WHERE match_status IS NULL OR match_status = 'unmatched') as unmatched,
          COUNT(*) as total,
          COALESCE(SUM(amount), 0) as total_amount
        FROM sage_supplier_payments
      `;

      return apiResponse.success(res, {
        lastSync: lastSync[0] || null,
        stats: {
          matched: parseInt(stats[0]?.matched as string || '0'),
          unmatched: parseInt(stats[0]?.unmatched as string || '0'),
          total: parseInt(stats[0]?.total as string || '0'),
          totalAmount: parseFloat(stats[0]?.total_amount as string || '0'),
        },
      });
    } catch (error) {
      logger.error('Failed to get payment sync status', { error });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Trigger payment sync
  if (req.method === 'POST') {
    const { sinceDate } = req.body;

    try {
      const client = await getSageClientFromDb(sql);
      const result = await pullPaymentsFromSage(client, sql, {
        sinceDate: sinceDate ? new Date(sinceDate) : undefined,
      });

      // Update last_sync_at
      await sql`
        UPDATE sage_api_config
        SET last_sync_at = NOW(), updated_at = NOW()
        WHERE is_active = true
      `;

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Payment sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
