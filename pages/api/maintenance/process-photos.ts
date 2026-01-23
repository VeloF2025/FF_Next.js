/**
 * Maintenance Photo Processing Endpoint
 *
 * POST /api/maintenance/process-photos - Process pending photos (download from bridge, upload to SharePoint)
 * GET /api/maintenance/process-photos - Get photo processing statistics
 *
 * @module api/maintenance/process-photos
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import {
  processPendingPhotos,
  getPhotoStats,
} from '@/modules/maintenance/services/maintenancePhotoService';

const logger = createLogger('api:maintenance:process-photos');

interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export default async function handler(
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
      logger.error({ error: errorMessage }, 'Failed to get photo stats');

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

      logger.info({ limit }, 'Starting photo processing batch');

      const results = await processPendingPhotos(limit);

      logger.info(
        {
          processed: results.processed,
          succeeded: results.succeeded,
          failed: results.failed,
        },
        'Photo processing batch complete'
      );

      return res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Photo processing failed');

      return res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  return res.status(405).json({
    success: false,
    error: 'Method not allowed',
  });
}
