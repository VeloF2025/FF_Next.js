/**
 * EOD Reconciliation API
 * GET: 3-way reconciliation for a given date (EOD ↔ WA DRs ↔ OES)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { getReconciliation } from '@/modules/data-sync/services/eodReconciliationService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const date = req.query.date as string;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiResponse.badRequest(res, 'date query parameter required (YYYY-MM-DD)');
  }

  try {
    const result = await getReconciliation(date);
    return apiResponse.success(res, result);
  } catch (err) {
    log.error('[EOD-Recon] Error', { error: err, date });
    return apiResponse.internalError(res, err, 'Reconciliation failed');
  }
}

export default withAuth(handler);
