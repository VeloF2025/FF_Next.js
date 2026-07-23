/**
 * Cron Job: Backfill Missing OneMap Data
 *
 * POST /api/cron/backfill-onemap-data
 *
 * Purpose: Find DRs with missing or incomplete photos/serials and fetch from OneMap
 *
 * This cron job handles the backfill case where:
 * - DRs exist in dr_photo_unified_reviews but have photo_count = 0
 * - DRs ingested only PART of their 1Map photos (local < cloud) because the
 *   1Map API was slow mid-ingest — see the 2026-07-23 incident, where 1Map
 *   went from 0.1s to 30s+ per query for hours and DRs landed with 1-5 of
 *   their 8-15 photos. The zero case is already covered by the wired
 *   refetch-missing-photos cron; the PARTIAL case had no owner.
 * - DRs have no ONT/UPS serials even though data exists in OneMap
 *
 * Run schedule: Every 15 minutes, via scripts/cron-backfill-onemap.sh.
 * (vercel.json also lists it, but this app deploys to systemd on Velocity,
 * so the vercel entry is inert — the shell cron is the real scheduler.)
 * Limit: Processes up to 20 DRs per run, bounded by RUN_BUDGET_MS.
 *
 * The per-DR fetch/reconcile logic lives in onemapBackfillService.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { backfillDr, type BackfillResult } from '@/modules/activate/services/onemapBackfillService';
import {
  buildCandidateQuery,
  countAgedOut,
} from '@/modules/activate/services/onemapBackfillQueries';

const log = createLogger('BackfillOneMap');

// Stop a slow run before the next 15-min tick so invocations never pile up
// (the shell wrapper also holds an flock).
const RUN_BUDGET_MS = 240_000;

interface BackfillResponse {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  deferred: number;
  agedOut: number;
  budgetExhausted: boolean;
  results: BackfillResult[];
  timestamp: string;
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BackfillResponse | { error: string }>
): Promise<void> {
  // Accept both GET and POST for flexibility
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }

  // Verify cron secret unconditionally — dev shares the production database
  // so bypassing auth in non-production environments is not safe.
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('CRON_SECRET not configured');
    return apiResponse.internalError(res, new Error('CRON_SECRET not configured'));
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    log.error('Unauthorized request');
    return apiResponse.unauthorized(res);
  }

  const limit = Number(req.query.limit) || Number(req.body?.limit) || 20;
  const mode = (req.query.mode as string) || (req.body?.mode as string) || 'missing_photos';

  log.info(`Starting backfill job (limit: ${limit}, mode: ${mode})`);

  try {
    const pendingResult = await pool.query<{ drop_number: string }>(
      buildCandidateQuery(mode),
      [limit]
    );
    const pendingDRs = pendingResult.rows;
    const agedOut = mode === 'unverified' ? await countAgedOut() : 0;

    if (agedOut > 0) {
      log.warn(`${agedOut} DR(s) aged out of the lookback window still unresolved`);
    }

    if (pendingDRs.length === 0) {
      log.info('No DRs need backfill');
      return res.status(200).json({
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        deferred: 0,
        agedOut,
        budgetExhausted: false,
        results: [],
        timestamp: new Date().toISOString(),
      });
    }

    log.info(`Found ${pendingDRs.length} DRs to process`);

    const results: BackfillResult[] = [];
    let succeeded = 0;
    let failed = 0;
    const startedAt = Date.now();
    let budgetExhausted = false;

    // Process each DR sequentially (to avoid overwhelming OneMap API)
    for (const row of pendingDRs) {
      // A degraded 1Map can spend 30s+ on a single DR. Stop before the next
      // tick rather than silently running long — the leftovers are still
      // selected next run, so nothing is dropped, but say so out loud.
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        budgetExhausted = true;
        log.warn('Run budget exhausted — deferring remaining DRs to next run', {
          processed: results.length,
          remaining: pendingDRs.length - results.length,
        });
        break;
      }

      const result = await backfillDr(row.drop_number);
      results.push(result);

      if (result.success && (result.photoCount > 0 || result.ontSerial || result.upsSerial)) {
        succeeded++;
      } else {
        failed++;
      }

      // Small delay between requests to be nice to OneMap
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const deferred = pendingDRs.length - results.length;

    log.info(`Completed: ${succeeded}/${results.length} succeeded`, {
      failed,
      deferred,
      agedOut,
      results: results.slice(0, 5), // Log first 5 for brevity
    });

    return res.status(200).json({
      success: true,
      processed: results.length,
      succeeded,
      failed,
      deferred,
      agedOut,
      budgetExhausted,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Fatal error during backfill', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run backfill',
    });
  }
}
