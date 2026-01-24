/**
 * WA Monitor Projects Summary API
 * GET /api/wa-monitor-projects-summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Returns stats for all projects combined + comprehensive metrics
 * Supports date range filtering via query parameters
 * Used for Projects Dashboard page
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/modules/wa-monitor/lib/apiResponse';
import { getAllProjectsStatsSummary } from '@/modules/wa-monitor/services/waMonitorService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Extract date range from query parameters (optional)
    const { startDate, endDate } = req.query;

    const summary = await getAllProjectsStatsSummary(
      startDate as string | undefined,
      endDate as string | undefined
    );

    return apiResponse.success(res, summary);

  } catch (error: any) {
    console.error('Error in wa-monitor-projects-summary API:', error);
    return apiResponse.internalError(res, error, 'Failed to fetch projects summary');
  }
}

export default withAuth(handler);
