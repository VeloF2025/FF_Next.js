/**
 * API: Smartsheet sync history
 * GET /api/pipeline/smartsheet/history?configId=xxx
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';import { apiResponse } from '@/lib/apiResponse';
import { pipelineSmartsheetService } from '@/modules/pipeline/services';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, ['GET']);
  }

  try {
    const { configId, limit } = req.query;

    if (!configId || typeof configId !== 'string') {
      return apiResponse.badRequest(res, 'configId query parameter required');
    }

    const history = await pipelineSmartsheetService.getSyncHistory(
      configId,
      limit ? parseInt(limit as string, 10) : 10
    );

    return apiResponse.success(res, {
      history,
      count: history.length,
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
