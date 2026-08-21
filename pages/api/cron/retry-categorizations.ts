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
import { checkVlmHealth } from '@/lib/vlm/config';

const log = createLogger('RetryCategorizations');

const MAX_RETRY_ATTEMPTS = 5;
const API_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3005';
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

interface RetryResult {
  dropNumber: string;
  source: 'failed' | 'bad_categorized' | 'partial_error' | 'post_qa_error';
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

    // 3. Find DRs with status='categorized' but SOME photos have Error results
    //    These have partial failures — VLM succeeded on some photos but timed out on others.
    //    They are excluded from query 2 (which requires ALL to be errors) but are still broken.
    const partialErrorResult = await pool.query(
      `SELECT dr.drop_number
       FROM dr_photo_unified_reviews dr
       WHERE dr.vlm_categorization_status = 'categorized'
         AND dr.vlm_categorization_results IS NOT NULL
         AND dr.auto_qa_processed = false
         AND (dr.human_review_status IS NULL OR dr.human_review_status != 'completed')
         AND (dr.vlm_retry_count IS NULL OR dr.vlm_retry_count < $1)
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(dr.vlm_categorization_results) elem
           WHERE elem->>'vlm_predicted_category' = 'Error'
         )
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(dr.vlm_categorization_results) elem
           WHERE (elem->>'vlm_predicted_step')::int != 0
             AND elem->>'vlm_predicted_category' != 'Error'
         )
       ORDER BY dr.updated_at ASC
       LIMIT $2`,
      [MAX_RETRY_ATTEMPTS, limit]
    );

    // 4. Find DRs already auto-QA processed but with Error photos still in vlm results.
    //    These had partial VLM failures that auto-QA ran through anyway (using what it had).
    //    The HITL reviewer sees these as "Discard 0% confidence" photos that should be valid.
    //    Reset them so re-categorization and auto-QA run again.
    //
    //    Excludes human_review_status IN ('completed','in_progress') so we never
    //    clobber a reviewer mid-session — only pending_hitl / NULL DRs are eligible.
    //    Requires vlm_categorization_results IS NOT NULL so jsonb_array_elements()
    //    doesn't fault on a null jsonb input (Q2 / Q3 already have the same guard).
    const postQaErrorResult = await pool.query(
      `SELECT dr.drop_number
       FROM dr_photo_unified_reviews dr
       WHERE dr.vlm_categorization_status = 'categorized'
         AND dr.vlm_categorization_results IS NOT NULL
         AND dr.auto_qa_processed = true
         AND dr.feedback_sent = false
         AND (dr.human_review_status IS NULL
              OR dr.human_review_status NOT IN ('completed', 'in_progress'))
         AND (dr.vlm_retry_count IS NULL OR dr.vlm_retry_count < $1)
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(dr.vlm_categorization_results) elem
           WHERE elem->>'vlm_predicted_category' = 'Error'
         )
       ORDER BY dr.updated_at ASC
       LIMIT $2`,
      [MAX_RETRY_ATTEMPTS, limit]
    );

    const failedDRs = failedResult.rows.map((r) => ({ drop_number: r.drop_number, source: 'failed' as const }));
    const badDRs = badCategorizedResult.rows.map((r) => ({ drop_number: r.drop_number, source: 'bad_categorized' as const }));
    const partialDRs = partialErrorResult.rows.map((r) => ({ drop_number: r.drop_number, source: 'partial_error' as const }));
    const postQaDRs = postQaErrorResult.rows.map((r) => ({ drop_number: r.drop_number, source: 'post_qa_error' as const }));

    // Deduplicate
    const seen = new Set<string>();
    const allDRs = [...failedDRs, ...badDRs, ...partialDRs, ...postQaDRs].filter((dr) => {
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

    // Note: when a post_qa_error DR's reset succeeds it sets auto_qa_processed=false.
    // On the next cron run it would match Q3 (partial-error) instead of Q4, with
    // a slightly weaker reset (no auto_qa_results/human_review_status NULL).
    // That's intentional: by then the DR has already been through the post-QA
    // reset path; Q3's gentler retry is the correct follow-up.
    log.info(`Found ${failedDRs.length} failed + ${badDRs.length} all-error + ${partialDRs.length} partial-error + ${postQaDRs.length} post-qa-error DRs to retry`);

    // Infrastructure outages must not consume a DR's retry budget.
    //
    // Every attempt below increments vlm_retry_count, and the selection queries
    // above only match `vlm_retry_count < MAX_RETRY_ATTEMPTS`. So when the VLM
    // itself is down, this cron burns all 5 attempts against a dead service and
    // the DR is then excluded from retry *permanently* — it never recovers even
    // after the VLM comes back. That is exactly what stranded 95 DRs during the
    // 2026-08-20 vLLM outage (service down 09:16 -> next day 08:40), leaving
    // technicians with no feedback for a full day.
    //
    // Bail out before touching any counters: no work is better than work that
    // silently destroys the ability to retry later.
    const health = await checkVlmHealth();
    if (!health.available) {
      log.error(
        `VLM unavailable (${health.error ?? 'no models served'}) — skipping ${allDRs.length} DRs without consuming retry budget`
      );
      return apiResponse.success(res, {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: allDRs.length,
        skipReason: 'vlm_unavailable',
        results: [] as RetryResult[],
        timestamp: new Date().toISOString(),
      });
    }

    const results: RetryResult[] = [];

    for (const dr of allDRs) {
      try {
        // Reset to 'processing' state. For post_qa_error DRs also clear auto_qa
        // state so auto-QA reruns after fresh categorization. The two branches
        // are written as separate parameterised statements (rather than a
        // single template-literal column list) so future edits can't
        // accidentally interpolate untrusted values into the UPDATE.
        if (dr.source === 'post_qa_error') {
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET vlm_categorization_status = 'processing',
                 vlm_retry_count = COALESCE(vlm_retry_count, 0) + 1,
                 auto_qa_processed = false,
                 auto_qa_results = NULL,
                 human_review_status = NULL,
                 updated_at = NOW()
             WHERE drop_number = $1`,
            [dr.drop_number]
          );
        } else {
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET vlm_categorization_status = 'processing',
                 vlm_retry_count = COALESCE(vlm_retry_count, 0) + 1,
                 updated_at = NOW()
             WHERE drop_number = $1`,
            [dr.drop_number]
          );
        }

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
          // Clear retry tracking on success — but only for sources where
          // 'categorized' means truly clean. drCategorizationService returns
          // 'categorized' for partial-error batches too, so post_qa_error DRs
          // can come back from process-new-dr with Error photos still present.
          // Resetting vlm_retry_count to 0 here would re-qualify them for Q4
          // on the next cron run, producing an unbounded retry loop.
          // For post_qa_error we leave the (incremented) counter in place so
          // MAX_RETRY_ATTEMPTS bounds the retries.
          if (dr.source !== 'post_qa_error') {
            await pool.query(
              `UPDATE dr_photo_unified_reviews
               SET vlm_retry_count = 0, vlm_last_error = NULL, vlm_next_retry_at = NULL
               WHERE drop_number = $1`,
              [dr.drop_number]
            );
          } else {
            await pool.query(
              `UPDATE dr_photo_unified_reviews
               SET vlm_last_error = NULL, vlm_next_retry_at = NULL
               WHERE drop_number = $1`,
              [dr.drop_number]
            );
          }

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
