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
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dateFrom, dateTo, project } = req.query;

    // Validate required parameters
    if (!dateFrom || !dateTo) {
      return res.status(400).json({
        error: 'Missing required parameters: dateFrom and dateTo',
      });
    }

    const dateFromStr = Array.isArray(dateFrom) ? dateFrom[0] : dateFrom;
    const dateToStr = Array.isArray(dateTo) ? dateTo[0] : dateTo;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;

    log.info('TeamPerformanceAPI', 'Fetching team performance report', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectStr,
    });

    const data = await getTeamPerformanceReport(
      dateFromStr as string,
      dateToStr as string,
      projectStr
    );

    return res.status(200).json(data);
  } catch (error) {
    log.error('TeamPerformanceAPI', 'Failed to fetch team performance report', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(withRole('manager')(handler));
