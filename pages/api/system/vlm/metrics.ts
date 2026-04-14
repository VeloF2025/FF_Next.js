/**
 * API: VLM Metrics
 *
 * GET /api/system/vlm/metrics - Get VLM accuracy metrics
 * GET /api/system/vlm/metrics/summary - Get module-level summaries
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { getVlmMetrics, getModuleAccuracySummaries } from '@/services/vlmLearningService';
import type { VlmModule, VlmAnalysisType } from '@/types/vlm-learning';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { summary, module, analysisType, dateFrom, dateTo, groupBy } = req.query;

    // Module summary endpoint
    if (summary === 'modules') {
      const summaries = await getModuleAccuracySummaries();
      return apiResponse.success(res, { summaries });
    }

    // Detailed metrics
    const options = {
      module: module as VlmModule | undefined,
      analysisType: analysisType as VlmAnalysisType | undefined,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined,
      groupBy: (groupBy as 'day' | 'week' | 'month') || 'day',
    };

    const metrics = await getVlmMetrics(options);
    return apiResponse.success(res, metrics);
  } catch (error) {
    log.error(`Error: ${error}`, undefined, 'VlmMetricsAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole(['admin', 'system_admin'])(handler));
