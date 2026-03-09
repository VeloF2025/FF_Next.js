/**
 * Batch Payment Actions API
 * POST — approve, process, cancel
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  approveBatch,
  processBatch,
  cancelBatch,
} from '@/modules/accounting/services/batchPaymentService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { action, id } = req.body;
    const userId = (req as unknown as { user?: { id: string } }).user?.id;
    if (!userId) return apiResponse.unauthorized(res, 'Unauthorized');
    if (!action || !id) return apiResponse.badRequest(res, 'action and id are required');

    switch (action) {
      case 'approve': {
        if (!userId) return apiResponse.unauthorized(res, 'Unauthorized');
        await approveBatch(id, userId);
        return apiResponse.success(res, { status: 'approved' });
      }
      case 'process': {
        if (!userId) return apiResponse.unauthorized(res, 'Unauthorized');
        await processBatch(id, userId);
        return apiResponse.success(res, { status: 'processed' });
      }
      case 'cancel':
        await cancelBatch(id);
        return apiResponse.success(res, { status: 'cancelled' });
      default:
        return apiResponse.badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Action failed';
    log.error('Batch payment action failed', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, msg);
  }
}

export default withAuth(withErrorHandler(handler));
