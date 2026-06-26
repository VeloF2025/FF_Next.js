/**
 * Cron Job: Re-fetch Missing Photos (late 1Map-sync recovery)
 *
 * GET/POST /api/cron/refetch-missing-photos
 *
 * Runs every 5 minutes (alongside auto-qa). Finds DRs that came back with no
 * photos — process-new-dr fetched them, OneMap/1Map had nothing, persistNoPhotos
 * left them at photo_count=0 / vlm_categorization_status='pending'. If the tech's
 * photos sync to 1Map *after* the initial webhook's ~1-min retries gave up, the DR
 * is otherwise stranded forever (invisible to both the auto-qa cron, which needs
 * photo_count>0, and the retry-categorizations cron, which only handles
 * 'failed'/'processing'/'categorized'-with-errors).
 *
 * This cron re-attempts the fetch via process-new-dr, bounded by a rolling
 * window + an attempt cap so a genuinely-absent install is not retried forever.
 *
 * It sends NO WhatsApp messages. A recovered DR (photos now present) simply
 * re-enters the normal pipeline: the auto-qa cron picks it up and the existing,
 * already-gated auto-feedback cron handles any technician message — exactly as if
 * the photos had arrived on time. This endpoint only triggers photo fetch +
 * categorization.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';

const log = createLogger('RefetchMissingPhotos');

// ~24h of retries at the 2-hour backoff below — enough for a late 1Map sync,
// bounded so a never-captured install stops being retried.
const MAX_REFETCH_ATTEMPTS = 12;
const API_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3005';

interface EligibleRow {
  drop_number: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: CRON_SECRET not set');
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    log.error('Unauthorized request');
    return apiResponse.unauthorized(res, 'Invalid or missing cron secret');
  }
  const bridgeSecret = process.env.WA_BRIDGE_SECRET;
  if (!bridgeSecret) {
    log.error('WA_BRIDGE_SECRET not configured');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: WA_BRIDGE_SECRET not set');
  }

  const requestedLimit = Number(req.query.limit) || Number(req.body?.limit) || 10;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 50))
    : 10;

  try {
    // Eligible: WA-originated DRs that fetched empty, are recent (rolling 48h
    // window — never the old backlog), have settled past the initial webhook,
    // are not yet QA'd/sent, and are under the attempt cap + past their backoff.
    const { rows } = await pool.query<EligibleRow>(
      `SELECT drop_number
       FROM dr_photo_unified_reviews
       WHERE (photo_count = 0 OR photo_count IS NULL)
         AND vlm_categorization_status = 'pending'
         AND auto_qa_processed = false
         AND feedback_sent = false
         AND wa_received_at IS NOT NULL
         AND wa_received_at >= NOW() - INTERVAL '48 hours'
         AND wa_received_at <= NOW() - INTERVAL '30 minutes'
         AND COALESCE(photo_refetch_attempts, 0) < $1
         AND (photo_refetch_next_at IS NULL OR photo_refetch_next_at <= NOW())
       ORDER BY wa_received_at ASC
       LIMIT $2`,
      [MAX_REFETCH_ATTEMPTS, limit]
    );

    log.info(`Re-fetch scan: ${rows.length} stranded no-photo DR(s)`);

    if (rows.length === 0) {
      return apiResponse.success(res, {
        processed: 0,
        recovered: 0,
        stillMissing: 0,
        failed: 0,
        timestamp: new Date().toISOString(),
      });
    }

    let recovered = 0;
    let stillMissing = 0;
    let failed = 0;

    for (const { drop_number } of rows) {
      try {
        // Re-run the exact fetch+categorize path used on first receipt. This
        // sends no messages — it only pulls photos and runs VLM categorization.
        const response = await fetch(`${API_BASE}/api/activate/process-new-dr`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-secret': bridgeSecret,
          },
          body: JSON.stringify({ dropNumber: drop_number, secret: bridgeSecret }),
        });
        const data = await response.json();
        const photosDownloaded = Number(data?.data?.photosDownloaded ?? 0);

        if (data.success && photosDownloaded > 0) {
          // Photos arrived — DR now has photo_count>0 and exits this query's
          // eligibility; the normal auto-qa pipeline takes over from here.
          recovered++;
          log.info(`Recovered ${photosDownloaded} photo(s) for ${drop_number}`);
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET photo_refetch_attempts = COALESCE(photo_refetch_attempts, 0) + 1,
                 photo_refetch_next_at = NULL
             WHERE drop_number = $1`,
            [drop_number]
          );
        } else {
          // Still nothing in 1Map — back off and try again later, up to the cap.
          stillMissing++;
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET photo_refetch_attempts = COALESCE(photo_refetch_attempts, 0) + 1,
                 photo_refetch_next_at = NOW() + INTERVAL '2 hours'
             WHERE drop_number = $1`,
            [drop_number]
          );
        }
      } catch (err) {
        failed++;
        log.error(`Re-fetch error for ${drop_number}`, { err: String(err) });
        await pool
          .query(
            `UPDATE dr_photo_unified_reviews
             SET photo_refetch_attempts = COALESCE(photo_refetch_attempts, 0) + 1,
                 photo_refetch_next_at = NOW() + INTERVAL '2 hours'
             WHERE drop_number = $1`,
            [drop_number]
          )
          .catch(() => {
            /* best effort — next cycle retries */
          });
      }
    }

    log.info(`Completed: ${recovered} recovered, ${stillMissing} still missing, ${failed} failed`);

    return apiResponse.success(res, {
      processed: rows.length,
      recovered,
      stillMissing,
      failed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    return apiResponse.internalError(res, error);
  }
}
