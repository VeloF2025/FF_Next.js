/**
 * Fleet Vehicle Scorecard API
 * GET /api/fleet/analytics/vehicle-scorecard
 *
 * Returns per-vehicle metrics: distance, fuel, compliance, driver, project
 *
 * Query params:
 * - startDate: YYYY-MM-DD (default: 3 months ago)
 * - endDate: YYYY-MM-DD (default: today)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getVehicleScorecard } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';
import { isValidDate } from '@/modules/fleet/services/mileageUtils';

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const today = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const startDate = (req.query.startDate as string) || threeMonthsAgo.toISOString().split('T')[0]!;
    const endDate = (req.query.endDate as string) || today.toISOString().split('T')[0]!;

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return apiResponse.validationError(res, { dates: 'Dates must be in YYYY-MM-DD format' });
    }

    const report = await getVehicleScorecard(startDate, endDate);

    return apiResponse.success(res, report);
  } catch (error) {
    log.error('Failed to get vehicle scorecard', { error });
    return apiResponse.internalError(res, error);
  }
}));
