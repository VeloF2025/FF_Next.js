/**
 * API Route: /api/activate/reporting/daily-counts
 *
 * Purpose: Get daily DR counts with zone/PON breakdown
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - project (optional): Filter by project name
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDailyCountsWithBreakdown } from '@/modules/activate/services/reportingService';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { dateFrom, dateTo, project } = req.query;

    // Validate required parameters
    if (!dateFrom || !dateTo) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing required parameters: dateFrom and dateTo');
    }

    const dateFromStr = Array.isArray(dateFrom) ? dateFrom[0] : dateFrom;
    const dateToStr = Array.isArray(dateTo) ? dateTo[0] : dateTo;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;

    log.info('Fetching daily counts', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectStr,
    }, 'DailyCountsAPI');


    const data = await getDailyCountsWithBreakdown(
      dateFromStr ?? '',
      dateToStr ?? '',
      projectStr || undefined
    );

    return res.status(200).json(data);
  } catch (error) {
    log.error('Failed to fetch daily counts', { error: { error } }, 'DailyCountsAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
