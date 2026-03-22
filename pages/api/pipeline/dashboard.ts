/**
 * Pipeline Dashboard API
 * GET /api/pipeline/dashboard - Get dashboard statistics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineProjectService } from '@/modules/pipeline/services/pipelineProjectService';
import { withAuth } from '@/lib/auth';
import { cachedQuery } from '@/lib/queryCache';
import { log } from '@/lib/logger';

/** Cache TTL: 5 minutes — pipeline dashboard aggregates across all pipeline projects */
const CACHE_TTL_MS = 300_000;
const CACHE_KEY = 'pipeline-dashboard-stats';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const stats = await cachedQuery(
    'reporting',
    CACHE_KEY,
    async () => {
      log.debug('Cache miss — querying database', { cacheKey: CACHE_KEY }, 'PipelineDashboard');
      return pipelineProjectService.getDashboardStats();
    },
    CACHE_TTL_MS
  );

  return apiResponse.success(res, stats);
}

export default withAuth(withErrorHandler(handler));
