/**
 * API Route: /api/activate/reporting/trends
 *
 * Purpose: Get trend analysis report with velocity metrics
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - groupBy (optional): 'day' | 'week' | 'month' (default: 'day')
 * - project (optional): Filter by project name
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getTrendAnalysisReport } from '@/modules/activate/services/reportingService';
import type { TrendGroupBy } from '@/modules/activate/types/reporting.types';
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
    const { dateFrom, dateTo, groupBy, project } = req.query;

    // Validate required parameters
    if (!dateFrom || !dateTo) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing required parameters: dateFrom and dateTo');
    }

    const dateFromStr = Array.isArray(dateFrom) ? dateFrom[0] : dateFrom;
    const dateToStr = Array.isArray(dateTo) ? dateTo[0] : dateTo;
    const groupByStr = (
      groupBy
        ? Array.isArray(groupBy)
          ? groupBy[0]
          : groupBy
        : 'day'
    ) as TrendGroupBy;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;

    log.info('TrendsAPI', 'Fetching trend analysis report', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      groupBy: groupByStr,
      project: projectStr,
    });

    const data = await getTrendAnalysisReport(
      dateFromStr as string,
      dateToStr as string,
      groupByStr,
      projectStr
    );

    return apiResponse.success(res, data);
  } catch (error) {
    log.error('TrendsAPI', 'Failed to fetch trend analysis report', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
