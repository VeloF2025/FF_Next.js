/**
 * Fleet Driver Scorecard API
 * GET /api/fleet/drivers/[staffId]/scorecard - Get detailed scorecard for a driver
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDriverScorecard } from '@/modules/fleet/services';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { ScorePeriod } from '@/modules/fleet/types/driver-score.types';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { staffId, period = 'monthly', historyMonths = '6' } = req.query;

    if (!staffId || typeof staffId !== 'string') {
      return apiResponse.badRequest(res, 'staffId is required');
    }

    // Validate period
    const validPeriods: ScorePeriod[] = ['daily', 'weekly', 'monthly'];
    if (!validPeriods.includes(period as ScorePeriod)) {
      return apiResponse.badRequest(res, 'Invalid period. Must be daily, weekly, or monthly');
    }

    const scorecard = await getDriverScorecard(
      staffId,
      period as ScorePeriod,
      Math.min(parseInt(String(historyMonths), 10) || 6, 24)
    );

    return apiResponse.success(res, scorecard);
  } catch (error) {
    log.error('Failed to get driver scorecard', { error, staffId: req.query.staffId });

    if (error instanceof Error && error.message === 'Driver not found') {
      return apiResponse.notFound(res, 'Driver', String(req.query.staffId));
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
