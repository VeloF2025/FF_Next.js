/**
 * Field Ops Photo Processing Endpoint
 *
 * POST /api/field-ops/process-photos
 *   - Validates x-cron-secret header
 *   - Runs photo download + staging batch (fieldOpsPhotoService)
 *   - Runs VLM validation + cross-reference batch (fieldOpsVlmService)
 *   - Returns combined results
 *
 * Intended for cron invocation every few minutes.
 *
 * @module api/field-ops/process-photos
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { processPendingPhotos } from '@/modules/field-ops/services/fieldOpsPhotoService';
import { validatePendingPhotos } from '@/modules/field-ops/services/fieldOpsVlmService';

const logger = createLogger('api:field-ops:process-photos');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
    return;
  }

  // Validate cron secret
  const cronSecret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
    apiResponse.unauthorized(res, 'Invalid or missing cron secret');
    return;
  }

  const { photoLimit = 10, vlmLimit = 5 } = req.body || {};

  logger.info('Starting field-ops photo processing', { photoLimit, vlmLimit });

  try {
    // Phase 1: Download + stage photos from WhatsApp bridge
    const photoResults = await processPendingPhotos(Number(photoLimit));

    logger.info('Photo download batch complete', {
      processed: photoResults.processed,
      succeeded: photoResults.succeeded,
      failed: photoResults.failed,
    });

    // Phase 2: VLM validation + project cross-reference
    const vlmResults = await validatePendingPhotos(Number(vlmLimit));

    logger.info('VLM validation batch complete', {
      processed: vlmResults.processed,
      succeeded: vlmResults.succeeded,
      failed: vlmResults.failed,
    });

    apiResponse.success(res, {
      photos: photoResults,
      vlm: vlmResults,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Field-ops photo processing failed', { error: errorMessage });
    apiResponse.internalError(res, error, 'Photo processing pipeline failed');
  }
}
