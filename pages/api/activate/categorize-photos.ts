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

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('CategorizePhotos');
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
import {
  getStepAccuracy,
  assignTiers,
  buildSummary,
} from '@/modules/activate/services/autoApprovalService';


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

    log.info(`Starting categorization for ${dropNumber}`, { force, batchSize });

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
          log.info(`Already categorized for ${dropNumber}, skipping`);

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
    log.info(`Fetching photos for ${dropNumber} with retry`);
    const fetchResult = await fetchPhotosWithRetry(dropNumber, {
      maxRetries: 5,
      initialDelayMs: 2000,
      onStatusUpdate: (status) => {
        log.debug(`Photo fetch status: ${status.message}`, {
          dropNumber,
          attempt: status.attempt,
          status: status.status,
        });
      },
    });

    const { photos, ont_barcode, ups_serial, fetchAttempts, downloadTriggered, totalWaitTimeMs } = fetchResult;

    log.info(`Photo fetch complete for ${dropNumber}`, {
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

    log.info(`Found ${photos.length} photos for ${dropNumber}`);

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

    // Auto-approval: assign tiers based on confidence + historical accuracy
    let autoApprovalTiers;
    let autoApprovalSummary;
    try {
      const stepAccuracy = await getStepAccuracy();
      autoApprovalTiers = assignTiers(categorizations, stepAccuracy);
      autoApprovalSummary = buildSummary(autoApprovalTiers, stepAccuracy);

      log.info(`Auto-approval tiers for ${dropNumber}`, {
        auto: autoApprovalSummary.autoApproved,
        review: autoApprovalSummary.reviewRecommended,
        human: autoApprovalSummary.humanRequired,
        overallAccuracy: autoApprovalSummary.overallAccuracy
          ? `${Math.round(autoApprovalSummary.overallAccuracy * 100)}%`
          : 'N/A',
      });
    } catch (tierError) {
      log.warn('Auto-approval tier assignment failed, falling back', { tierError });
    }

    const processingTimeMs = Date.now() - startTime;

    log.info(`Categorization complete for ${dropNumber}`, {
      photoCount: categorizations.length,
      processingTimeMs,
    });

    const response: CategorizePhotosResponse = {
      dropNumber,
      status: 'categorized',
      photoCount: categorizations.length,
      categorizations,
      processingTimeMs,
      autoApprovalTiers,
      autoApprovalSummary,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Error during categorization', { error });

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
      log.error('Failed to update status to failed', { error: dbError });
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
    let categorizations = row.vlm_categorization_results || [];
    let status = row.vlm_categorization_status;

    // Detect corrupted results: status is 'categorized' but results are empty objects
    // This happens when cron job stored data with wrong property names
    if (
      (status === 'categorized' || status === 'approved') &&
      categorizations.length > 0 &&
      categorizations.every((c: Record<string, unknown>) => !c.vlm_predicted_step && !c.photo_filename)
    ) {
      log.warn(`Detected corrupted VLM results for ${dropNumber}, resetting to pending`);
      status = 'pending';
      categorizations = [];
    }

    // Compute auto-approval tiers for existing results
    let autoApprovalTiers;
    let autoApprovalSummary;
    if (categorizations.length > 0 && (status === 'categorized' || status === 'approved')) {
      try {
        const stepAccuracy = await getStepAccuracy();
        autoApprovalTiers = assignTiers(categorizations, stepAccuracy);
        autoApprovalSummary = buildSummary(autoApprovalTiers, stepAccuracy);
      } catch (tierError) {
        log.warn('Failed to compute auto-approval tiers for GET', { error: tierError });
      }
    }

    return apiResponse.success(res, {
      dropNumber,
      status,
      categorizations,
      categorizedAt: row.vlm_categorized_at,
      approvedBy: row.vlm_approved_by,
      approvedAt: row.vlm_approved_at,
      autoApprovalTiers,
      autoApprovalSummary,
    });
  } catch (error) {
    log.error('Error getting categorization', { error });
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
