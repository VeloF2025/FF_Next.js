/**
 * Cron Job: Construction QA VLM Processing
 *
 * POST /api/cron/construction-qa-vlm
 *
 * Purpose: Run VLM categorization and validation for pending construction QA reviews
 * (pole installations, cable spans, joints) that have photos but no VLM data.
 *
 * Processes reviews where:
 * - vlm_status = 'pending' or 'failed' (with retry limit)
 * - photo_count > 0
 * - At least one photo has upload_status = 'available'
 *
 * Run schedule: Every 5 minutes
 * Limit: Processes up to 10 reviews per run, 1 concurrent (each review = 7+ sequential VLM calls)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { validateReviewPhotos } from '@/modules/construction-qa/services/vlmConstructionService';
import { checkVlmHealth } from '@/lib/vlm/config';
import type { Discipline } from '@/modules/construction-qa/types/construction.types';

const MAX_RETRY_COUNT = 3;

interface ReviewResult {
  reviewId: string;
  featureId: string;
  discipline: string;
  success: boolean;
  photosProcessed: number;
  overallConfidence: number | null;
  error?: string;
}

interface CronResponse {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: ReviewResult[];
  timestamp: string;
}

/**
 * Process a single construction QA review through VLM
 */
async function processReview(
  reviewId: string,
  discipline: Discipline,
  featureId: string
): Promise<ReviewResult> {
  const result: ReviewResult = {
    reviewId,
    featureId,
    discipline,
    success: false,
    photosProcessed: 0,
    overallConfidence: null,
  };

  try {
    const vlmResult = await validateReviewPhotos({
      reviewId,
      discipline,
    });

    result.success = vlmResult.vlmStatus === 'completed';
    result.photosProcessed = vlmResult.photosProcessed;
    result.overallConfidence = vlmResult.overallConfidence;

    if (vlmResult.vlmStatus !== 'completed' && vlmResult.error) {
      result.error = vlmResult.error;
    }

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    log.error('ConstructionQaVlm', {
      action: 'processReview',
      reviewId,
      featureId,
      error: result.error,
    });
    return result;
  }
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CronResponse | { error: string }>
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }

  // Verify cron secret
  const authHeader = req.headers.authorization;
  const querySecret = req.query.secret as string | undefined;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const providedSecret = authHeader?.replace('Bearer ', '') || querySecret;
    if (providedSecret !== cronSecret) {
      return apiResponse.unauthorized(res);
    }
  }

  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const discipline = (req.query.discipline as string) || null;

  log.info('ConstructionQaVlm', {
    action: 'start',
    limit,
    discipline: discipline || 'all',
  });

  try {
    // Find reviews needing VLM processing
    // Use separate query branches to avoid conditional SQL fragments (Neon rule)
    let pendingResult;

    if (discipline) {
      pendingResult = await pool.query(
        `SELECT r.id, r.discipline, r.feature_id, r.feature_type,
                r.photo_count, r.vlm_retry_count
         FROM construction_qa_reviews r
         WHERE r.discipline = $1
           AND (r.vlm_status = 'pending' OR (r.vlm_status = 'failed' AND COALESCE(r.vlm_retry_count, 0) < $2))
           AND r.photo_count > 0
           AND EXISTS (
             SELECT 1 FROM construction_qa_photos p
             WHERE p.review_id = r.id AND p.upload_status = 'available'
               AND p.vlm_processed_at IS NULL
           )
         ORDER BY
           CASE WHEN r.vlm_status = 'pending' THEN 0 ELSE 1 END,
           COALESCE(r.vlm_retry_count, 0) ASC,
           r.created_at ASC
         LIMIT $3`,
        [discipline, MAX_RETRY_COUNT, limit]
      );
    } else {
      pendingResult = await pool.query(
        `SELECT r.id, r.discipline, r.feature_id, r.feature_type,
                r.photo_count, r.vlm_retry_count
         FROM construction_qa_reviews r
         WHERE (r.vlm_status = 'pending' OR (r.vlm_status = 'failed' AND COALESCE(r.vlm_retry_count, 0) < $1))
           AND r.photo_count > 0
           AND EXISTS (
             SELECT 1 FROM construction_qa_photos p
             WHERE p.review_id = r.id AND p.upload_status = 'available'
               AND p.vlm_processed_at IS NULL
           )
         ORDER BY
           CASE WHEN r.vlm_status = 'pending' THEN 0 ELSE 1 END,
           COALESCE(r.vlm_retry_count, 0) ASC,
           r.created_at ASC
         LIMIT $2`,
        [MAX_RETRY_COUNT, limit]
      );
    }

    const pendingReviews = pendingResult.rows;

    if (pendingReviews.length === 0) {
      log.info('ConstructionQaVlm', { action: 'noop', message: 'No reviews need VLM processing' });
      return res.status(200).json({
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        results: [],
        timestamp: new Date().toISOString(),
      });
    }

    log.info('ConstructionQaVlm', {
      action: 'found',
      count: pendingReviews.length,
      breakdown: pendingReviews.reduce((acc: Record<string, number>, r) => {
        acc[r.discipline] = (acc[r.discipline] || 0) + 1;
        return acc;
      }, {}),
    });

    // Same guard as retry-categorizations and refetch-missing-photos, for the
    // same reason: processReview -> validateReviewPhotos increments
    // construction_qa_reviews.vlm_retry_count on any VLM failure, and the
    // selection above only takes rows under MAX_RETRY_COUNT. Running against a
    // dead VLM burns all attempts on the outage and permanently excludes those
    // reviews once it recovers.
    //
    // This table has 0 rows stranded today, unlike the DR side which has 468 —
    // the door is simply open rather than already walked through, and this cron
    // runs */5 with limit=10.
    const health = await checkVlmHealth();
    if (!health.available) {
      log.error('ConstructionQaVlm', {
        action: 'skipped_vlm_unavailable',
        reason: health.error ?? 'no models served',
        pending: pendingReviews.length,
      });
      return apiResponse.success(res, {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: pendingReviews.length,
        skipReason: 'vlm_unavailable',
        results: [],
        timestamp: new Date().toISOString(),
      });
    }

    const results: ReviewResult[] = [];
    let succeeded = 0;
    let failed = 0;
    const skipped = 0;

    // Process sequentially — each review has 7+ sequential VLM calls internally
    // Running multiple reviews concurrently would overload the single GPU
    for (const row of pendingReviews) {
      const result = await processReview(
        row.id,
        row.discipline as Discipline,
        row.feature_id
      );

      results.push(result);
      if (result.success) {
        succeeded++;
        log.info('ConstructionQaVlm', {
          action: 'processed',
          featureId: row.feature_id,
          photos: result.photosProcessed,
          confidence: result.overallConfidence,
        });
      } else {
        failed++;
        log.warn('ConstructionQaVlm', {
          action: 'failed',
          featureId: row.feature_id,
          error: result.error,
        });
      }

      // Brief pause between reviews to let VLM recover
      if (pendingReviews.indexOf(row) < pendingReviews.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    log.info('ConstructionQaVlm', {
      action: 'complete',
      processed: pendingReviews.length,
      succeeded,
      failed,
      skipped,
    });

    return res.status(200).json({
      success: true,
      processed: pendingReviews.length,
      succeeded,
      failed,
      skipped,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('ConstructionQaVlm', { action: 'fatal', error: errorMessage });
    return res.status(500).json({
      error: errorMessage || 'Failed to process construction QA VLM queue',
    });
  }
}
