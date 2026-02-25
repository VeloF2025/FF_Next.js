/**
 * Bank Transactions API
 * GET /api/accounting/bank-transactions - List transactions (with filters)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getBankTransactions } from '@/modules/accounting/services/bankReconciliationService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { bank_account_id, reconciliation_id, status, from_date, to_date, limit, offset } = req.query;
    const result = await getBankTransactions({
      bankAccountId: bank_account_id ? String(bank_account_id) : undefined,
      reconciliationId: reconciliation_id ? String(reconciliation_id) : undefined,
      status: status ? String(status) : undefined,
      fromDate: from_date ? String(from_date) : undefined,
      toDate: to_date ? String(to_date) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return apiResponse.success(res, result);
  } catch (err) {
    log.error('Failed to get bank transactions', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, 'Failed to get bank transactions');
  }
}

export default withAuth(withErrorHandler(handler));
