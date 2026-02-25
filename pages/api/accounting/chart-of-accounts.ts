/**
 * Chart of Accounts API
 * GET  /api/accounting/chart-of-accounts - List all accounts (flat or tree)
 * POST /api/accounting/chart-of-accounts - Create new account
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  getChartOfAccounts,
  getAccountTree,
  createAccount,
} from '@/modules/accounting/services/chartOfAccountsService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { view, subtype } = req.query;
      let data;
      if (view === 'tree') {
        data = await getAccountTree();
      } else {
        const accounts = await getChartOfAccounts();
        data = subtype
          ? accounts.filter(a => a.accountSubtype === String(subtype))
          : accounts;
      }
      return apiResponse.success(res, data);
    } catch (err) {
      log.error('Failed to get chart of accounts', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, 'Failed to get chart of accounts');
    }
  }

  if (req.method === 'POST') {
    try {
      const { accountCode, accountName, accountType, accountSubtype, parentAccountId, description, normalBalance } = req.body;

      if (!accountCode || !accountName || !accountType || !normalBalance) {
        return apiResponse.badRequest(res, 'accountCode, accountName, accountType, and normalBalance are required');
      }

      const account = await createAccount({
        accountCode,
        accountName,
        accountType,
        accountSubtype,
        parentAccountId,
        description,
        normalBalance,
      });

      return apiResponse.success(res, account);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create account';
      log.error('Failed to create account', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, message);
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
