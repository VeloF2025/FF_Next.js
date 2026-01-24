/**
 * Fleet Analytics API - Cost Trends
 * GET /api/fleet/analytics/cost-trends - Get cost trends over time
 *
 * Query params:
 * - period: 'daily' | 'weekly' | 'monthly' (default: 'monthly')
 * - months: number (default: 12)
 * - vehicleId: optional UUID for single vehicle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getCostTrends } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const {
      period = 'monthly',
      months = '12',
      vehicleId,
    } = req.query;

    // Validate period
    if (!['daily', 'weekly', 'monthly'].includes(period as string)) {
      return apiResponse.validationError(res, { period: 'Invalid period. Use "daily", "weekly", or "monthly"' });
    }

    // Validate months
    const monthsNum = parseInt(months as string, 10);
    if (isNaN(monthsNum) || monthsNum < 1 || monthsNum > 36) {
      return apiResponse.validationError(res, { months: 'Invalid months. Use a number between 1 and 36' });
    }

    const costTrends = await getCostTrends(
      period as 'daily' | 'weekly' | 'monthly',
      monthsNum,
      vehicleId as string | undefined
    );

    return apiResponse.success(res, costTrends);
  } catch (error) {
    log.error('Failed to get cost trends', { error });
    return apiResponse.internalError(res, error);
  }
}));
