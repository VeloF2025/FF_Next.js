/**
 * Bank Transaction Actions API
 * POST /api/accounting/bank-transactions-action
 *   action: match | unmatch | exclude | auto_match
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  matchTransaction,
  unmatchTransaction,
  excludeTransaction,
  autoMatchTransactions,
  allocateTransaction,
  type AllocationType,
} from '@/modules/accounting/services/bankReconciliationService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { action, bankTransactionId, journalLineId, bankAccountId, reconciliationId, contraAccountId, description, allocationType, entityId } = req.body;
    // @ts-expect-error — auth middleware attaches user
    const userId: string = req.user?.id || req.user?.userId || 'system';

    if (!action) return apiResponse.badRequest(res, 'action is required');

    switch (action) {
      case 'match': {
        if (!bankTransactionId || !journalLineId) {
          return apiResponse.badRequest(res, 'bankTransactionId and journalLineId are required');
        }
        const tx = await matchTransaction(bankTransactionId, journalLineId, reconciliationId);
        return apiResponse.success(res, tx);
      }
      case 'unmatch': {
        if (!bankTransactionId) return apiResponse.badRequest(res, 'bankTransactionId is required');
        const tx = await unmatchTransaction(bankTransactionId);
        return apiResponse.success(res, tx);
      }
      case 'exclude': {
        if (!bankTransactionId) return apiResponse.badRequest(res, 'bankTransactionId is required');
        const tx = await excludeTransaction(bankTransactionId);
        return apiResponse.success(res, tx);
      }
      case 'auto_match': {
        if (!bankAccountId) return apiResponse.badRequest(res, 'bankAccountId is required');
        const result = await autoMatchTransactions(bankAccountId, reconciliationId);
        return apiResponse.success(res, result);
      }
      case 'allocate': {
        const aType: AllocationType = allocationType || 'account';
        if (aType === 'account' && !contraAccountId) {
          return apiResponse.badRequest(res, 'contraAccountId is required for account allocation');
        }
        if ((aType === 'supplier' || aType === 'customer') && !entityId) {
          return apiResponse.badRequest(res, 'entityId is required for supplier/customer allocation');
        }
        if (!bankTransactionId) {
          return apiResponse.badRequest(res, 'bankTransactionId is required');
        }
        const result = await allocateTransaction(
          bankTransactionId, contraAccountId || '', userId, description, aType, entityId,
        );
        return apiResponse.success(res, result);
      }
      default:
        return apiResponse.badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action failed';
    log.error('Bank transaction action failed', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, message);
  }
}

export default withAuth(withErrorHandler(handler));
