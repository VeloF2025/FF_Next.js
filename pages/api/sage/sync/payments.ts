/**
 * Sage Payment Sync API
 *
 * POST - Pull payments from Sage
 * GET - Get sync status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { createSageClientFromConfig } from '@/services/sage';
import { pullPaymentsFromSage, getPOPaymentSummary } from '@/services/sage/entities/paymentSync';

const logger = createLogger({ module: 'api:sage:sync:payments' });

export default async function handler(
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
          matched: parseInt(stats[0]?.matched || '0'),
          unmatched: parseInt(stats[0]?.unmatched || '0'),
          total: parseInt(stats[0]?.total || '0'),
          totalAmount: parseFloat(stats[0]?.total_amount || '0'),
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
      // Get Sage config
      const configResult = await sql`
        SELECT
          client_id,
          client_secret,
          company_id,
          base_url,
          access_token,
          refresh_token,
          token_expires_at
        FROM sage_api_config
        WHERE is_active = true AND is_connected = true
        LIMIT 1
      `;

      if (configResult.length === 0) {
        return apiResponse.badRequest(res, 'Sage is not configured or not connected');
      }

      const config = configResult[0];

      // Create Sage client
      const client = createSageClientFromConfig({
        clientId: config.client_id,
        clientSecret: config.client_secret,
        companyId: config.company_id,
        baseUrl: config.base_url,
        accessToken: config.access_token,
        refreshToken: config.refresh_token,
        expiresAt: config.token_expires_at ? new Date(config.token_expires_at) : undefined,
      });

      // Run sync
      const result = await pullPaymentsFromSage(client, sql, {
        sinceDate: sinceDate ? new Date(sinceDate) : undefined,
      });

      // Update tokens if refreshed
      const tokens = client.getTokens();
      if (tokens && tokens.accessToken !== config.access_token) {
        await sql`
          UPDATE sage_api_config
          SET
            access_token = ${tokens.accessToken},
            refresh_token = ${tokens.refreshToken},
            token_expires_at = ${tokens.expiresAt.toISOString()},
            updated_at = NOW()
          WHERE is_active = true
        `;
      }

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Payment sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, ['GET', 'POST']);
}
