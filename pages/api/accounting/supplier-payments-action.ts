/**
 * Supplier Payment Actions API
 * POST /api/accounting/supplier-payments-action
 *   action: approve | process
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  approveSupplierPayment,
  processSupplierPayment,
} from '@/modules/accounting/services/supplierPaymentService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { action, paymentId } = req.body;
    const userId = authReq.user.id;

    if (!action || !paymentId) {
      return apiResponse.badRequest(res, 'action and paymentId are required');
    }

    switch (action) {
      case 'approve': {
        const payment = await approveSupplierPayment(paymentId, userId);
        return apiResponse.success(res, payment);
      }
      case 'process': {
        const payment = await processSupplierPayment(paymentId, userId);
        return apiResponse.success(res, payment);
      }
      default:
        return apiResponse.badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action failed';
    log.error('Supplier payment action failed', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, message);
  }
}

export default withAuth(withErrorHandler(handler));
