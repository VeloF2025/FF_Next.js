/**
 * Maintenance Photo Processing Endpoint
 *
 * POST /api/noc/process-photos - Process pending photos (download from bridge, upload to SharePoint)
 * GET /api/noc/process-photos - Get photo processing statistics
 *
 * @module api/noc/process-photos
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import {
  processPendingPhotos,
  getPhotoStats,
} from '@/modules/noc/services/maintenancePhotoService';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:maintenance:process-photos');

interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // GET - Return photo statistics
  if (req.method === 'GET') {
    try {
      const stats = await getPhotoStats();

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get photo stats', { error: errorMessage });

      return res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  // POST - Process pending photos
  if (req.method === 'POST') {
    try {
      const { limit = 10 } = req.body || {};

      logger.info('Starting photo processing batch', { limit });

      const results = await processPendingPhotos(limit);

      logger.info('Photo processing batch complete', {
          processed: results.processed,
          succeeded: results.succeeded,
          failed: results.failed,
        });

      return res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('Photo processing failed', { error: errorMessage });

      return res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

export default withAuth(handler);
