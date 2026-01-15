/**
 * Fleet Fuel Summary API
 * GET /api/fleet/fuel/summary
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { getFleetFuelSummary } from '@/modules/fleet/services';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    const period = (req.query.period as 'week' | 'month' | 'quarter' | 'year') || 'month';

    const summary = await getFleetFuelSummary(period);

    return apiResponse.success(res, summary);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
