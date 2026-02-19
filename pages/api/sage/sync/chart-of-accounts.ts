/**
 * Sage Chart of Accounts Sync API
 *
 * POST - Pull chart of accounts from Sage
 * GET - Get local chart of accounts
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { getSageClientFromDb } from '@/services/sage/sageClient';
import { pullChartOfAccounts } from '@/services/sage/entities/chartOfAccountsSync';

const logger = createLogger('api:sage:sync:chart-of-accounts');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    try {
      const accounts = await sql`
        SELECT
          sage_account_id,
          name,
          category_id,
          category_description,
          reporting_group_id,
          reporting_group_description,
          account_type,
          is_active,
          balance
        FROM sage_accounts
        WHERE is_active = true
        ORDER BY category_description, name
      `;

      return apiResponse.success(res, { accounts, total: accounts.length });
    } catch (error) {
      logger.error('Failed to get chart of accounts', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const client = await getSageClientFromDb(sql);
      const result = await pullChartOfAccounts(client, sql);

      await sql`
        UPDATE sage_api_config
        SET last_sync_at = NOW(), updated_at = NOW()
        WHERE is_active = true
      `;

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Chart of accounts sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
