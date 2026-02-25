/**
 * Bank Reconciliations API
 * GET  /api/accounting/bank-reconciliations - List reconciliation sessions
 * POST /api/accounting/bank-reconciliations - Start new reconciliation
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  getReconciliations,
  getReconciliationById,
  startReconciliation,
} from '@/modules/accounting/services/bankReconciliationService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { bank_account_id, id } = req.query;

      if (id) {
        const recon = await getReconciliationById(String(id));
        if (!recon) return apiResponse.notFound(res, 'Reconciliation', String(id));
        return apiResponse.success(res, recon);
      }

      const result = await getReconciliations(
        bank_account_id ? String(bank_account_id) : undefined
      );
      return apiResponse.success(res, result);
    } catch (err) {
      log.error('Failed to get reconciliations', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, 'Failed to get reconciliations');
    }
  }

  if (req.method === 'POST') {
    try {
      const { bankAccountId, statementDate, statementBalance } = req.body;
      const userId = req.body.userId || (req as unknown as { user?: { id: string } }).user?.id;

      if (!bankAccountId || !statementDate || statementBalance === undefined) {
        return apiResponse.badRequest(res, 'bankAccountId, statementDate, and statementBalance are required');
      }
      if (!userId) return apiResponse.badRequest(res, 'userId is required');

      const recon = await startReconciliation(
        String(bankAccountId), String(statementDate),
        Number(statementBalance), userId
      );
      return apiResponse.created(res, recon);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start reconciliation';
      log.error('Failed to start reconciliation', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, message);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
