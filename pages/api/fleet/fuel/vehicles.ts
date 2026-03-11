/**
 * Fleet Vehicle Fuel Stats API
 * GET /api/fleet/fuel/vehicles
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { getVehicleFuelStats } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    const period = (req.query.period as 'month' | 'quarter' | 'year') || 'month';
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const stats = await getVehicleFuelStats(period, limit);

    return apiResponse.success(res, stats);
  } catch (error) {
    log.error('VehiclesApi', 'Internal error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
