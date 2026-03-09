/**
 * VAT Adjustments API
 * GET  — list VAT adjustments
 * POST — create VAT adjustment
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  getVATAdjustments,
  createVATAdjustment,
} from '@/modules/accounting/services/vatAdjustmentService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { status, limit, offset } = req.query;
    const result = await getVATAdjustments({
      status: status as string,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return apiResponse.success(res, result);
  }

  if (req.method === 'POST') {
    const userId = (req as unknown as { user?: { id: string } }).user?.id;
    if (!userId) return apiResponse.unauthorized(res, 'Unauthorized');
    try {
      const item = await createVATAdjustment(req.body, userId);
      return apiResponse.success(res, item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      log.error('VAT adjustment create failed', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, msg);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
