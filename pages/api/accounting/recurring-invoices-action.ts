/**
 * Recurring Invoice Actions API
 * POST — pause, resume, cancel, generate
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  updateRecurringStatus,
  generateInvoiceFromRecurring,
} from '@/modules/accounting/services/recurringInvoiceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { action, id } = req.body;
    const userId = authReq.user.id;
    if (!action || !id) return apiResponse.badRequest(res, 'action and id are required');

    switch (action) {
      case 'pause':
        await updateRecurringStatus(id, 'paused');
        return apiResponse.success(res, { status: 'paused' });
      case 'resume':
        await updateRecurringStatus(id, 'active');
        return apiResponse.success(res, { status: 'active' });
      case 'cancel':
        await updateRecurringStatus(id, 'cancelled');
        return apiResponse.success(res, { status: 'cancelled' });
      case 'generate': {
        const invoiceId = await generateInvoiceFromRecurring(id, userId);
        return apiResponse.success(res, { invoiceId });
      }
      default:
        return apiResponse.badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Action failed';
    log.error('Recurring invoice action failed', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, msg);
  }
}

export default withAuth(withErrorHandler(handler));
