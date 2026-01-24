/**
 * WA Monitor Project Stats API
 * GET /api/wa-monitor-project-stats?project={projectName}
 *
 * Returns real-time stats for a specific project:
 * - Today, This Week, This Month, All-Time
 * - Total drops, Complete, Incomplete, Completion Rate
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/modules/wa-monitor/lib/apiResponse';
import { getProjectStats } from '@/modules/wa-monitor/services/waMonitorService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { project } = req.query;

  if (!project || typeof project !== 'string') {
    return apiResponse.validationError(res, { project: 'Project name is required' });
  }

  try {
    const stats = await getProjectStats(project);

    return apiResponse.success(res, {
      project,
      stats,
    });

  } catch (error: any) {
    console.error('Error in wa-monitor-project-stats API:', error);
    return apiResponse.internalError(res, error, 'Failed to fetch project stats');
  }
}

export default withAuth(handler);
