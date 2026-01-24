/**
 * Fleet Fuel Cost Breakdown API
 * GET /api/fleet/fuel/cost-breakdown
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { getFuelCostBreakdown } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    const period = (req.query.period as 'month' | 'quarter' | 'year') || 'month';

    const breakdown = await getFuelCostBreakdown(period);

    return apiResponse.success(res, breakdown);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
