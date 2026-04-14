/**
 * API Route: /api/activate/validate-qa
 *
 * Purpose: Phase 2 - Run VLM QA validation on categorized photos
 * Method: POST (run validation), GET (get results)
 *
 * This endpoint:
 * 1. Takes photos that have been categorized (Phase 1)
 * 2. Runs VLM QA validation against FiberTime Installation Standards
 * 3. Stores results for human review (Phase 3)
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import {
  validateBatch,
  generateBatchFeedback,
  QaPhotoInput,
} from '@/modules/activate/services/vlmQaValidationService';
import {
  logVlmQaStarted,
  logVlmQaCompleted,
  logVlmQaFailed,
} from '@/modules/activate/services/activityLogService';
import { STEP_LABELS } from '@/modules/activate/utils/stepMapper';

interface ValidateQaRequest {
  dropNumber: string;
  force?: boolean;
}

/**
 * POST /api/activate/validate-qa
 * Run VLM QA validation on categorized photos
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, force } = req.body as ValidateQaRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info(`Starting QA validation for ${dropNumber}`, { force }, 'ValidateQa');

    // Get the review record
    const reviewResult = await pool.query(
      `SELECT id, photos_metadata, vlm_categorization_results, vlm_qa_status, vlm_qa_results
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (reviewResult.rows.length === 0) {
      return apiResponse.notFound(res, 'Review', dropNumber);
    }

    const review = reviewResult.rows[0];

    // Check if already validated (skip unless forced)
    if (!force && review.vlm_qa_status === 'validated') {
      log.info(`Already validated for ${dropNumber}, skipping`, undefined, 'ValidateQa');

      return apiResponse.success(res, {
        dropNumber,
        status: 'validated',
        results: review.vlm_qa_results,
        skipped: true,
      });
    }

    // Get photos with their categorized steps
    const photosMetadata = review.photos_metadata || [];
    const categorizationResults = review.vlm_categorization_results || [];

    if (photosMetadata.length === 0) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No photos found for this DR');
    }

    // Build QA input from categorized photos
    const qaPhotos: QaPhotoInput[] = photosMetadata
      .map((photo: { filename: string; url: string; step?: number }) => {
        // Find the categorization result for this photo
        const catResult = categorizationResults.find(
          (c: { photo_filename: string; vlm_predicted_step: number }) =>
            c.photo_filename === photo.filename
        );

        // Use categorized step if available, otherwise use photo.step
        const step = catResult?.vlm_predicted_step || photo.step;

        if (!step || step < 1 || step > 10) {
          return null; // Skip photos without valid step
        }

        return {
          filename: photo.filename,
          url: photo.url,
          step,
        };
      })
      .filter((p: QaPhotoInput | null): p is QaPhotoInput => p !== null);

    if (qaPhotos.length === 0) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No categorized photos to validate');
    }

    // Log QA started
    await logVlmQaStarted(dropNumber, qaPhotos.length);

    // Update status to processing
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET vlm_qa_status = 'processing', updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber]
    );

    // Run VLM QA validation
    const batchResult = await validateBatch(dropNumber, qaPhotos);

    if (batchResult.status === 'failed') {
      await logVlmQaFailed(dropNumber, batchResult.error || 'Unknown error');

      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET vlm_qa_status = 'failed', updated_at = NOW()
         WHERE drop_number = $1`,
        [dropNumber]
      );

      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, batchResult.error || 'QA validation failed');
    }

    // Generate summary feedback
    const summary = generateBatchFeedback(batchResult);

    // Store results in database
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         vlm_qa_status = 'validated',
         vlm_qa_results = $1,
         vlm_qa_validated_at = NOW(),
         vlm_qa_summary = $2,
         updated_at = NOW()
       WHERE drop_number = $3`,
      [JSON.stringify(batchResult), summary, dropNumber]
    );

    // Log QA completed
    await logVlmQaCompleted(
      dropNumber,
      batchResult.totalPhotos,
      batchResult.passedCount,
      batchResult.passRate,
      batchResult.totalProcessingTimeMs
    );

    const processingTimeMs = Date.now() - startTime;

    log.info(`QA validation complete for ${dropNumber}`, {
      totalPhotos: batchResult.totalPhotos,
      passedCount: batchResult.passedCount,
      passRate: batchResult.passRate,
      processingTimeMs,
    }, 'ValidateQa');

    return apiResponse.success(res, {
      dropNumber,
      status: 'validated',
      totalPhotos: batchResult.totalPhotos,
      passedCount: batchResult.passedCount,
      failedCount: batchResult.failedCount,
      passRate: batchResult.passRate,
      criticalIssues: batchResult.criticalIssues,
      stepResults: batchResult.stepResults,
      summary,
      processingTimeMs,
    });
  } catch (error) {
    log.error('Error during QA validation', { error }, 'ValidateQa');

    // Try to update status to failed
    try {
      const { dropNumber } = req.body as ValidateQaRequest;
      if (dropNumber) {
        await logVlmQaFailed(dropNumber, error instanceof Error ? error.message : String(error));

        await pool.query(
          `UPDATE dr_photo_unified_reviews
           SET vlm_qa_status = 'failed', updated_at = NOW()
           WHERE drop_number = $1`,
          [dropNumber]
        );
      }
    } catch (dbError) {
      log.error('Failed to update status to failed', { error: dbError }, 'ValidateQa');
    }

    return apiResponse.internalError(res, error);
  }
}

/**
 * GET /api/activate/validate-qa?dropNumber=XXX
 * Get existing QA validation results
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    const result = await pool.query(
      `SELECT vlm_qa_status, vlm_qa_results, vlm_qa_validated_at, vlm_qa_summary,
              human_qa_overrides, human_review_status, human_review_completed_at, human_reviewer_id
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Review', dropNumber);
    }

    const row = result.rows[0];
    const qaResults = row.vlm_qa_results || {};

    return apiResponse.success(res, {
      dropNumber,
      status: row.vlm_qa_status,
      validatedAt: row.vlm_qa_validated_at,
      summary: row.vlm_qa_summary,
      totalPhotos: qaResults.totalPhotos || 0,
      passedCount: qaResults.passedCount || 0,
      failedCount: qaResults.failedCount || 0,
      passRate: qaResults.passRate || 0,
      criticalIssues: qaResults.criticalIssues || [],
      stepResults: qaResults.stepResults || [],
      humanOverrides: row.human_qa_overrides || {},
      humanReviewStatus: row.human_review_status,
      humanReviewCompletedAt: row.human_review_completed_at,
      humanReviewerId: row.human_reviewer_id,
    });
  } catch (error) {
    log.error('Error getting QA results', { error }, 'ValidateQa');
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
