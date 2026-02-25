/**
 * Supplier Invoice Actions API
 * POST /api/accounting/supplier-invoices-action
 *   action: approve | cancel | match
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  approveSupplierInvoice,
  cancelSupplierInvoice,
  performThreeWayMatch,
} from '@/modules/accounting/services/supplierInvoiceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { action, invoiceId, userId: bodyUserId } = req.body;
    const userId = bodyUserId || (req as unknown as { user?: { id: string } }).user?.id;

    if (!action || !invoiceId) {
      return apiResponse.badRequest(res, 'action and invoiceId are required');
    }

    switch (action) {
      case 'approve': {
        if (!userId) return apiResponse.badRequest(res, 'userId is required for approve');
        const invoice = await approveSupplierInvoice(invoiceId, userId);
        return apiResponse.success(res, invoice);
      }
      case 'cancel': {
        const invoice = await cancelSupplierInvoice(invoiceId);
        return apiResponse.success(res, invoice);
      }
      case 'match': {
        const result = await performThreeWayMatch(invoiceId);
        return apiResponse.success(res, result);
      }
      default:
        return apiResponse.badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action failed';
    log.error('Supplier invoice action failed', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, message);
  }
}

export default withAuth(withErrorHandler(handler));
