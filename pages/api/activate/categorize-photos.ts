/**
 * API Route: /api/activate/categorize-photos
 *
 * Purpose: Run VLM categorization on photos for a DR
 * Method: POST
 *
 * This endpoint:
 * 1. Fetches ALL photos from OneMap (raw, without pre-categorization)
 * 2. Sends photos to Qwen3 VLM for category prediction
 * 3. Stores VLM predictions for human review
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  categorizePhotos,
  PhotoInput,
} from '@/modules/activate/services/categorizationVlmService';
import {
  fetchPhotosWithRetry,
  checkPhotosExist,
} from '@/modules/activate/services/photoFetchService';
import {
  CategorizePhotosRequest,
  CategorizePhotosResponse,
  VlmCategorizationResult,
} from '@/modules/activate/types/unified.types';

// Configure Neon transport based on NEON_USE_HTTP env var
const useHttpTransport = process.env.NEON_USE_HTTP === 'true';

if (!useHttpTransport) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
  } catch {
    // ws not available, will use HTTP
  }
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});


/**
 * POST /api/activate/categorize-photos
 * Run VLM categorization on photos
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, force, batchSize } = req.body as CategorizePhotosRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('CategorizePhotos', `Starting categorization for ${dropNumber}`, { force, batchSize });

    // Check if already categorized (skip unless forced)
    if (!force) {
      const existingResult = await pool.query(
        `SELECT vlm_categorization_status, vlm_categorization_results
         FROM dr_photo_unified_reviews
         WHERE drop_number = $1`,
        [dropNumber]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];

        if (existing.vlm_categorization_status === 'categorized' ||
            existing.vlm_categorization_status === 'approved') {
          log.info('CategorizePhotos', `Already categorized for ${dropNumber}, skipping`);

          return apiResponse.success(res, {
            dropNumber,
            status: existing.vlm_categorization_status,
            photoCount: existing.vlm_categorization_results?.length || 0,
            categorizations: existing.vlm_categorization_results || [],
            processingTimeMs: Date.now() - startTime,
            skipped: true,
          } as CategorizePhotosResponse & { skipped: boolean });
        }
      }
    }

    // Update status to processing
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET vlm_categorization_status = 'processing', updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber]
    );

    // Fetch photos from OneMap with robust retry logic
    log.info('CategorizePhotos', `Fetching photos for ${dropNumber} with retry`);
    const fetchResult = await fetchPhotosWithRetry(dropNumber, {
      maxRetries: 5,
      initialDelayMs: 2000,
      onStatusUpdate: (status) => {
        log.debug('CategorizePhotos', `Photo fetch status: ${status.message}`, {
          dropNumber,
          attempt: status.attempt,
          status: status.status,
        });
      },
    });

    const { photos, ont_barcode, ups_serial, fetchAttempts, downloadTriggered, totalWaitTimeMs } = fetchResult;

    log.info('CategorizePhotos', `Photo fetch complete for ${dropNumber}`, {
      photoCount: photos.length,
      fetchAttempts,
      downloadTriggered,
      totalWaitTimeMs,
    });

    if (photos.length === 0) {
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET vlm_categorization_status = 'failed', updated_at = NOW()
         WHERE drop_number = $1`,
        [dropNumber]
      );

      return apiResponse.error(res, ErrorCode.NOT_FOUND, `No photos found for ${dropNumber}`);
    }

    log.info('CategorizePhotos', `Found ${photos.length} photos for ${dropNumber}`);

    // Run VLM categorization
    const categorizations = await categorizePhotos(dropNumber, photos, batchSize);

    // Store results in database
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         vlm_categorization_status = 'categorized',
         vlm_categorization_results = $1,
         vlm_categorized_at = NOW(),
         ont_serial_scanned = COALESCE($2, ont_serial_scanned),
         ups_serial_scanned = COALESCE($3, ups_serial_scanned),
         updated_at = NOW()
       WHERE drop_number = $4`,
      [JSON.stringify(categorizations), ont_barcode, ups_serial, dropNumber]
    );

    const processingTimeMs = Date.now() - startTime;

    log.info('CategorizePhotos', `Categorization complete for ${dropNumber}`, {
      photoCount: categorizations.length,
      processingTimeMs,
    });

    const response: CategorizePhotosResponse = {
      dropNumber,
      status: 'categorized',
      photoCount: categorizations.length,
      categorizations,
      processingTimeMs,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('CategorizePhotos', 'Error during categorization', error);

    // Try to update status to failed
    try {
      const { dropNumber } = req.body as CategorizePhotosRequest;
      if (dropNumber) {
        await pool.query(
          `UPDATE dr_photo_unified_reviews
           SET vlm_categorization_status = 'failed', updated_at = NOW()
           WHERE drop_number = $1`,
          [dropNumber]
        );
      }
    } catch (dbError) {
      log.error('CategorizePhotos', 'Failed to update status to failed', dbError);
    }

    return apiResponse.internalError(res, error);
  }
}

/**
 * GET /api/activate/categorize-photos?dropNumber=XXX
 * Get existing categorization results
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    const result = await pool.query(
      `SELECT vlm_categorization_status, vlm_categorization_results, vlm_categorized_at,
              vlm_approved_by, vlm_approved_at
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Review', dropNumber);
    }

    const row = result.rows[0];

    return apiResponse.success(res, {
      dropNumber,
      status: row.vlm_categorization_status,
      categorizations: row.vlm_categorization_results || [],
      categorizedAt: row.vlm_categorized_at,
      approvedBy: row.vlm_approved_by,
      approvedAt: row.vlm_approved_at,
    });
  } catch (error) {
    log.error('CategorizePhotos', 'Error getting categorization', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  } else if (req.method === 'GET') {
    return handleGet(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

export default withAuth(handler);
