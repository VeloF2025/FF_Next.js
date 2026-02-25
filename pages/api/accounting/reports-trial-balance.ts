/**
 * Trial Balance Report API
 * GET /api/accounting/reports-trial-balance?fiscal_period_id=...
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getTrialBalance } from '@/modules/accounting/services/journalEntryService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const fiscalPeriodId = req.query.fiscal_period_id as string;
    if (!fiscalPeriodId) {
      return apiResponse.badRequest(res, 'fiscal_period_id is required');
    }

    const rows = await getTrialBalance(fiscalPeriodId);
    const totalDebit = rows.reduce((sum, r) => sum + r.debitBalance, 0);
    const totalCredit = rows.reduce((sum, r) => sum + r.creditBalance, 0);

    return apiResponse.success(res, {
      fiscalPeriodId,
      rows,
      totalDebit,
      totalCredit,
    });
  } catch (err) {
    log.error('Failed to get trial balance', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, 'Failed to get trial balance');
  }
}

export default withAuth(withErrorHandler(handler));
