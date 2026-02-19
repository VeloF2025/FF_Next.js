/**
 * Sage Ledger Transaction Sync API
 *
 * POST - Pull detailed ledger transactions from Sage
 * GET - Get ledger sync status
 *
 * POST body: { fromDate: "YYYY-MM-DD", toDate: "YYYY-MM-DD" }
 * Defaults to current month if no dates provided.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { getSageClientFromDb } from '@/services/sage/sageClient';
import {
  pullLedgerTransactions,
  getLedgerSyncStatus,
} from '@/services/sage/entities/ledgerSync';

const logger = createLogger('api:sage:sync:ledger');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    try {
      const status = await getLedgerSyncStatus(sql);
      return apiResponse.success(res, status);
    } catch (error) {
      logger.error('Failed to get ledger sync status', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      let { fromDate, toDate } = req.body;

      // Default to current month
      if (!fromDate) {
        const now = new Date();
        fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      }
      if (!toDate) {
        toDate = new Date().toISOString().split('T')[0];
      }

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
        return apiResponse.badRequest(res, 'Invalid date format. Use YYYY-MM-DD.');
      }

      const client = await getSageClientFromDb(sql);
      const result = await pullLedgerTransactions(client, sql, {
        fromDate,
        toDate,
      });

      await sql`
        UPDATE sage_api_config
        SET last_sync_at = NOW(), updated_at = NOW()
        WHERE is_active = true
      `;

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Ledger sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
