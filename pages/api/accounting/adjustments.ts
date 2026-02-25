/**
 * Accounting Adjustments API
 * GET  — list adjustments (filter by ?entityType=customer|supplier)
 * POST — create adjustment
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getAdjustments, createAdjustment } from '@/modules/accounting/services/adjustmentService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { entityType, status, limit, offset } = req.query;
    const result = await getAdjustments({
      entityType: entityType as string,
      status: status as string,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return apiResponse.success(res, result);
  }

  if (req.method === 'POST') {
    const userId = (req as unknown as { user?: { id: string } }).user?.id || req.body.userId;
    if (!userId) return apiResponse.badRequest(res, 'userId is required');
    try {
      const item = await createAdjustment(req.body, userId);
      return apiResponse.success(res, item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      log.error('Adjustment create failed', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, msg);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
