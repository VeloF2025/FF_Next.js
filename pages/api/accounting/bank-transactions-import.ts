/**
 * Bank Statement Import API
 * POST /api/accounting/bank-transactions-import
 *   Import CSV bank statement
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { importBankStatement } from '@/modules/accounting/services/bankReconciliationService';
import type { BankFormat } from '@/modules/accounting/types/bank.types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { csvContent, bankAccountId, statementDate, bankFormat } = req.body;

    if (!csvContent || !bankAccountId || !statementDate) {
      return apiResponse.badRequest(res, 'csvContent, bankAccountId, and statementDate are required');
    }

    const result = await importBankStatement(
      csvContent,
      String(bankAccountId),
      String(statementDate),
      (bankFormat || undefined) as BankFormat | undefined
    );

    return apiResponse.created(res, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to import bank statement';
    log.error('Failed to import bank statement', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, message);
  }
}

export default withAuth(withErrorHandler(handler));
