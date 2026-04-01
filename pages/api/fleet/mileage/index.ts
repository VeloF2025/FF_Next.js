/**
 * Fleet Mileage Report API
 * GET /api/fleet/mileage - Get mileage report for all vehicles
 *
 * Query params:
 * - period: 'daily' | 'weekly' | 'monthly' | 'custom' (default: 'monthly')
 * - startDate: YYYY-MM-DD (auto-calculated if not custom)
 * - endDate: YYYY-MM-DD (auto-calculated if not custom)
 * - projectId: optional UUID to filter by project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getFleetMileage } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';
import type { MileagePeriod } from '@/modules/fleet/types';
import { getDefaultDateRange, isValidDate, isValidUUID } from '@/modules/fleet/services/mileageUtils';

const VALID_PERIODS: MileagePeriod[] = ['daily', 'weekly', 'monthly', 'custom'];

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { period: periodParam = 'monthly', startDate: startParam, endDate: endParam, projectId } = req.query;
    const period = periodParam as MileagePeriod;

    if (!VALID_PERIODS.includes(period)) {
      return apiResponse.validationError(res, { period: 'Invalid period. Use "daily", "weekly", "monthly", or "custom"' });
    }

    let startDate: string;
    let endDate: string;

    if (period === 'custom') {
      if (!startParam || !endParam) {
        return apiResponse.validationError(res, { dates: 'startDate and endDate are required for custom period' });
      }
      startDate = startParam as string;
      endDate = endParam as string;
    } else {
      const defaults = getDefaultDateRange(period);
      startDate = (startParam as string) || defaults.startDate;
      endDate = (endParam as string) || defaults.endDate;
    }

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return apiResponse.validationError(res, { dates: 'Dates must be in YYYY-MM-DD format' });
    }

    if (projectId && typeof projectId === 'string' && !isValidUUID(projectId)) {
      return apiResponse.validationError(res, { projectId: 'Invalid project ID format' });
    }

    const report = await getFleetMileage(
      period,
      startDate,
      endDate,
      projectId as string | undefined
    );

    return apiResponse.success(res, report);
  } catch (error) {
    log.error('Failed to get fleet mileage report', { error });
    return apiResponse.internalError(res, error);
  }
}));
