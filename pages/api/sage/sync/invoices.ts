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
import { getSageClientFromDb } from '@/services/sage/sageClient';
import {
  pullInvoicesFromSage,
  getUnmatchedInvoices,
  manuallyMatchInvoice,
} from '@/services/sage/entities/invoiceSync';

const logger = createLogger('api:sage:sync:invoices');

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
          matched: parseInt(stats[0]?.matched as string || '0'),
          unmatched: parseInt(stats[0]?.unmatched as string || '0'),
          paid: parseInt(stats[0]?.paid as string || '0'),
          total: parseInt(stats[0]?.total as string || '0'),
          totalAmount: parseFloat(stats[0]?.total_amount as string || '0'),
          outstandingAmount: parseFloat(stats[0]?.outstanding_amount as string || '0'),
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
      const client = await getSageClientFromDb(sql);
      const result = await pullInvoicesFromSage(client, sql, {
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
      logger.error('Invoice sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
