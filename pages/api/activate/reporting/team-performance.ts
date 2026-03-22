/**
 * API Route: /api/activate/reporting/team-performance
 *
 * Purpose: Get enhanced team performance report with leaderboard
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - project (optional): Filter by project name
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getTeamPerformanceReport } from '@/modules/activate/services/reportingService';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import { cachedQuery } from '@/lib/queryCache';

/** Cache TTL: 5 minutes — team performance data is aggregated and expensive to compute */
const CACHE_TTL_MS = 300_000;

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

    const cacheKey = `team-performance:${dateFromStr}:${dateToStr}:${projectStr ?? 'all'}`;

    log.info('TeamPerformanceAPI', 'Fetching team performance report', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectStr,
      cacheKey,
    });

    const data = await cachedQuery(
      'reporting',
      cacheKey,
      async () => {
        log.debug('Cache miss — querying database', { cacheKey }, 'TeamPerformanceAPI');
        return getTeamPerformanceReport(
          dateFromStr as string,
          dateToStr as string,
          projectStr
        );
      },
      CACHE_TTL_MS
    );

    return res.status(200).json(data);
  } catch (error) {
    log.error('TeamPerformanceAPI', 'Failed to fetch team performance report', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
