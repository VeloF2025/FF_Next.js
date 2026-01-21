/**
 * Pipeline Dashboard API
 * GET /api/pipeline/dashboard - Get dashboard statistics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineProjectService } from '@/modules/pipeline/services/pipelineProjectService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const stats = await pipelineProjectService.getDashboardStats();

  return apiResponse.success(res, stats);
}

export default withErrorHandler(handler);
