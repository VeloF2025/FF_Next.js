/**
 * Fleet Driver Score Calculation API
 * POST /api/fleet/drivers/calculate-scores - Calculate scores for all drivers
 *
 * This endpoint is intended to be called by a cron job to generate daily/weekly/monthly scores.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { calculateAllDriverScores, calculateDriverScore } from '@/modules/fleet/services';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { ScorePeriod } from '@/modules/fleet/types/driver-score.types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { period = 'monthly', date, staffId } = req.body;

    // Validate period
    const validPeriods: ScorePeriod[] = ['daily', 'weekly', 'monthly'];
    if (!validPeriods.includes(period as ScorePeriod)) {
      return apiResponse.badRequest(res, 'Invalid period. Must be daily, weekly, or monthly');
    }

    // If staffId provided, calculate for single driver
    if (staffId) {
      const score = await calculateDriverScore(
        staffId,
        period as ScorePeriod,
        date || undefined
      );

      return apiResponse.success(res, {
        message: 'Score calculated successfully',
        score,
      });
    }

    // Calculate for all drivers
    const scores = await calculateAllDriverScores(
      period as ScorePeriod,
      date || undefined
    );

    log.info('Driver scores calculated', { count: scores.length, period, date });

    return apiResponse.success(res, {
      message: `Calculated scores for ${scores.length} drivers`,
      count: scores.length,
      period,
      date: date || new Date().toISOString().split('T')[0],
    });
  } catch (error) {
    log.error('Failed to calculate driver scores', { error });
    return apiResponse.internalError(res, error);
  }
}
