/**
 * Fleet Driver Leaderboard API
 * GET /api/fleet/drivers/leaderboard - Get driver performance leaderboard
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getLeaderboard } from '@/modules/fleet/services';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { ScorePeriod } from '@/modules/fleet/types/driver-score.types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { period = 'monthly', limit = '20' } = req.query;

    // Validate period
    const validPeriods: ScorePeriod[] = ['daily', 'weekly', 'monthly'];
    if (!validPeriods.includes(period as ScorePeriod)) {
      return apiResponse.badRequest(res, 'Invalid period. Must be daily, weekly, or monthly');
    }

    const leaderboard = await getLeaderboard(
      period as ScorePeriod,
      Math.min(parseInt(String(limit), 10) || 20, 100)
    );

    return apiResponse.success(res, leaderboard);
  } catch (error) {
    log.error('Failed to get driver leaderboard', { error });
    return apiResponse.internalError(res, error);
  }
}
