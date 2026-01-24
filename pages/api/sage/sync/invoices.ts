/**
 * Sage Invoice Sync API
 *
 * POST - Pull invoices from Sage
 * GET - Get sync status and unmatched invoices
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { createSageClientFromConfig } from '@/services/sage';
import {
  pullInvoicesFromSage,
  getUnmatchedInvoices,
  manuallyMatchInvoice,
} from '@/services/sage/entities/invoiceSync';

const logger = createLogger({ module: 'api:sage:sync:invoices' });

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  // GET - Get sync status and unmatched invoices
  if (req.method === 'GET') {
    try {
      // Get last sync info
      const lastSync = await sql`
        SELECT *
        FROM sage_sync_history
        WHERE entity_type = 'supplier_invoice'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      // Get invoice stats
      const stats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE match_status = 'matched') as matched,
          COUNT(*) FILTER (WHERE match_status IS NULL OR match_status = 'unmatched') as unmatched,
          COUNT(*) FILTER (WHERE status = 'paid') as paid,
          COUNT(*) as total,
          COALESCE(SUM(total_amount), 0) as total_amount,
          COALESCE(SUM(outstanding_amount), 0) as outstanding_amount
        FROM sage_supplier_invoices
      `;

      // Get unmatched invoices for review
      const unmatchedInvoices = await getUnmatchedInvoices(sql);

      return apiResponse.success(res, {
        lastSync: lastSync[0] || null,
        stats: {
          matched: parseInt(stats[0]?.matched || '0'),
          unmatched: parseInt(stats[0]?.unmatched || '0'),
          paid: parseInt(stats[0]?.paid || '0'),
          total: parseInt(stats[0]?.total || '0'),
          totalAmount: parseFloat(stats[0]?.total_amount || '0'),
          outstandingAmount: parseFloat(stats[0]?.outstanding_amount || '0'),
        },
        unmatchedInvoices,
      });
    } catch (error) {
      logger.error('Failed to get invoice sync status', { error });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Trigger invoice sync or manual match
  if (req.method === 'POST') {
    const { action, invoiceId, poId, sinceDate } = req.body;

    // Manual matching action
    if (action === 'manual_match') {
      if (!invoiceId || !poId) {
        return apiResponse.badRequest(res, 'invoiceId and poId are required');
      }

      try {
        const success = await manuallyMatchInvoice(sql, invoiceId, poId);
        if (success) {
          return apiResponse.success(res, { message: 'Invoice matched successfully' });
        } else {
          return apiResponse.badRequest(res, 'Failed to match invoice');
        }
      } catch (error) {
        logger.error('Manual matching failed', { error });
        return apiResponse.internalError(res, error);
      }
    }

    // Default: Pull invoices from Sage
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
      const result = await pullInvoicesFromSage(client, sql, {
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
      logger.error('Invoice sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, ['GET', 'POST']);
}

export default withAuth(handler);
