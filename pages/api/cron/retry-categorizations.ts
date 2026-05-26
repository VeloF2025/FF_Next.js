/**
 * Cron Job: Retry Bad VLM Categorizations
 *
 * GET/POST /api/cron/retry-categorizations
 *
 * Runs every 5 minutes (alongside auto-qa cron). Finds DRs that:
 * 1. Have vlm_categorization_status = 'failed' and are eligible for retry
 * 2. Have vlm_categorization_status = 'categorized' but ALL results are Error/step=0
 *    (VLM was down when they were processed)
 *
 * Resets them and re-triggers categorization via process-new-dr endpoint.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';

const log = createLogger('RetryCategorizations');

const MAX_RETRY_ATTEMPTS = 5;
const API_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3005';
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

interface RetryResult {
  dropNumber: string;
  source: 'failed' | 'bad_categorized';
  success: boolean;
  message: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }

  // Require CRON_SECRET bearer token
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: CRON_SECRET not set');
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${cronSecret}`) {
    log.error('Unauthorized request');
    return apiResponse.unauthorized(res, 'Invalid or missing cron secret');
  }

  const limit = Number(req.query.limit) || Number(req.body?.limit) || 10;

  log.info(`Starting retry scan (limit: ${limit})`);

  try {
    // 1. Find DRs with status='failed' or stuck 'processing' eligible for retry
    const failedResult = await pool.query(
      `SELECT drop_number
       FROM dr_photo_unified_reviews
       WHERE vlm_categorization_status IN ('failed', 'processing')
         AND (vlm_retry_count IS NULL OR vlm_retry_count < $1)
         AND (vlm_next_retry_at IS NULL OR vlm_next_retry_at <= NOW())
       ORDER BY vlm_retry_count ASC NULLS FIRST, updated_at ASC
       LIMIT $2`,
      [MAX_RETRY_ATTEMPTS, limit]
    );

    // 2. Find DRs with status='categorized' but ALL Error/step=0 results
    //    These slipped through when VLM was down and categorizePhotos returned Error results
    const badCategorizedResult = await pool.query(
      `SELECT dr.drop_number
       FROM dr_photo_unified_reviews dr
       WHERE dr.vlm_categorization_status = 'categorized'
         AND dr.vlm_categorization_results IS NOT NULL
         AND dr.auto_qa_processed = false
         AND (dr.vlm_retry_count IS NULL OR dr.vlm_retry_count < $1)
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(dr.vlm_categorization_results) elem
           WHERE (elem->>'vlm_predicted_step')::int != 0
             AND elem->>'vlm_predicted_category' != 'Error'
         )
       ORDER BY dr.updated_at ASC
       LIMIT $2`,
      [MAX_RETRY_ATTEMPTS, limit]
    );

    const failedDRs = failedResult.rows.map((r) => ({ drop_number: r.drop_number, source: 'failed' as const }));
    const badDRs = badCategorizedResult.rows.map((r) => ({ drop_number: r.drop_number, source: 'bad_categorized' as const }));

    // Deduplicate
    const seen = new Set<string>();
    const allDRs = [...failedDRs, ...badDRs].filter((dr) => {
      if (seen.has(dr.drop_number)) return false;
      seen.add(dr.drop_number);
      return true;
    }).slice(0, limit);

    if (allDRs.length === 0) {
      log.info('No DRs need re-categorization');
      return apiResponse.success(res, {
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [] as RetryResult[],
        timestamp: new Date().toISOString(),
      });
    }

    log.info(`Found ${failedDRs.length} failed + ${badDRs.length} bad-categorized DRs to retry`);

    const results: RetryResult[] = [];

    for (const dr of allDRs) {
      try {
        // Reset to 'processing' state
        await pool.query(
          `UPDATE dr_photo_unified_reviews
           SET vlm_categorization_status = 'processing',
               vlm_retry_count = COALESCE(vlm_retry_count, 0) + 1,
               updated_at = NOW()
           WHERE drop_number = $1`,
          [dr.drop_number]
        );

        // Re-trigger categorization via process-new-dr
        const response = await fetch(`${API_BASE}/api/activate/process-new-dr`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-secret': BRIDGE_SECRET || '',
          },
          body: JSON.stringify({ dropNumber: dr.drop_number, secret: BRIDGE_SECRET }),
        });

        const data = await response.json();

        if (data.success && data.data?.categorizationStatus === 'categorized') {
          // Clear retry tracking on success
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET vlm_retry_count = 0, vlm_last_error = NULL, vlm_next_retry_at = NULL
             WHERE drop_number = $1`,
            [dr.drop_number]
          );

          results.push({
            dropNumber: dr.drop_number,
            source: dr.source,
            success: true,
            message: 'Re-categorization successful',
          });
        } else {
          // Restore to 'failed' so it gets retried next cycle
          const errorMsg = data.data?.categorizationStatus || data.error?.message || 'Unknown failure';
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET vlm_categorization_status = 'failed',
                 vlm_last_error = $1,
                 vlm_next_retry_at = NOW() + INTERVAL '5 minutes',
                 updated_at = NOW()
             WHERE drop_number = $2`,
            [errorMsg, dr.drop_number]
          );

          results.push({
            dropNumber: dr.drop_number,
            source: dr.source,
            success: false,
            message: errorMsg,
          });
        }
      } catch (error) {
        log.error(`Error retrying ${dr.drop_number}`, { error });

        // Restore to 'failed' so it gets retried next cycle
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await pool.query(
          `UPDATE dr_photo_unified_reviews
           SET vlm_categorization_status = 'failed',
               vlm_last_error = $1,
               vlm_next_retry_at = NOW() + INTERVAL '5 minutes',
               updated_at = NOW()
           WHERE drop_number = $2`,
          [errorMsg, dr.drop_number]
        ).catch(() => { /* best effort */ });

        results.push({
          dropNumber: dr.drop_number,
          source: dr.source,
          success: false,
          message: errorMsg,
        });
      }

      // Small delay between retries to avoid overwhelming VLM
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const succeeded = results.filter((r) => r.success).length;

    log.info(`Completed: ${succeeded}/${results.length} successful`);

    return apiResponse.success(res, {
      processed: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    return apiResponse.internalError(res, error);
  }
}
