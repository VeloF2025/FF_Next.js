/**
 * Fleet Mileage Project Summaries API
 * GET /api/fleet/mileage/project-summaries - Get per-project mileage totals
 *
 * Query params:
 * - startDate: YYYY-MM-DD (default: 12 months ago)
 * - endDate: YYYY-MM-DD (default: today)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getProjectMileageSummaries } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const today = new Date();
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    const startDate = (req.query.startDate as string) || yearAgo.toISOString().split('T')[0]!;
    const endDate = (req.query.endDate as string) || today.toISOString().split('T')[0]!;

    const summaries = await getProjectMileageSummaries(startDate, endDate);

    return apiResponse.success(res, summaries);
  } catch (error) {
    log.error('Failed to get project mileage summaries', { error });
    return apiResponse.internalError(res, error);
  }
}));
