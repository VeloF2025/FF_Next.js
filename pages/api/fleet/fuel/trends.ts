/**
 * Fleet Fuel Efficiency Trends API
 * GET /api/fleet/fuel/trends
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { getFuelEfficiencyTrends } from '@/modules/fleet/services';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    const period = (req.query.period as 'week' | 'month' | 'quarter') || 'month';
    const vehicleId = req.query.vehicleId as string | undefined;

    const trends = await getFuelEfficiencyTrends(period, vehicleId);

    return apiResponse.success(res, trends);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
