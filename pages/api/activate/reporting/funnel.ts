/**
 * API Route: /api/activate/reporting/funnel
 *
 * Purpose: Get QA workflow funnel report
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - project (optional): Filter by project name
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getQAFunnelReport } from '@/modules/activate/services/reportingService';
import { log } from '@/lib/logger';

export default async function handler(
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

    log.info('FunnelAPI', 'Fetching QA funnel report', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectStr,
    });

    const data = await getQAFunnelReport(
      dateFromStr as string,
      dateToStr as string,
      projectStr
    );

    return res.status(200).json(data);
  } catch (error) {
    log.error('FunnelAPI', 'Failed to fetch QA funnel report', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
