/**
 * Fleet Fuel Summary API
 * GET /api/fleet/fuel/summary
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { getFleetFuelSummary } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const period = (req.query.period as 'week' | 'month' | 'quarter' | 'year') || 'month';

    const summary = await getFleetFuelSummary(period);

    return apiResponse.success(res, summary);
  } catch (error) {
    log.error('Internal error', { error: { error } }, 'SummaryApi');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
