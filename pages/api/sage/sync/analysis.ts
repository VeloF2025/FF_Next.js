/**
 * Sage Analysis Sync API
 *
 * POST - Pull analysis types + categories from Sage
 * GET - Get analysis sync status (types, categories, mapping stats)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { getSageClientFromDb } from '@/services/sage/sageClient';
import {
  pullAnalysisData,
  getAnalysisSyncStatus,
} from '@/services/sage/entities/analysisSync';

const logger = createLogger('api:sage:sync:analysis');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    try {
      const status = await getAnalysisSyncStatus(sql);
      return apiResponse.success(res, status);
    } catch (error) {
      logger.error('Failed to get analysis sync status', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const client = await getSageClientFromDb(sql);
      const result = await pullAnalysisData(client, sql);

      await sql`
        UPDATE sage_api_config
        SET last_sync_at = NOW(), updated_at = NOW()
        WHERE is_active = true
      `;

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Analysis sync failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
