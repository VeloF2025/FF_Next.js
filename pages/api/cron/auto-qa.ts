/**
 * Cron Job: Auto-QA Pipeline
 *
 * GET/POST /api/cron/auto-qa
 *
 * Runs every 5 minutes. Finds DRs eligible for automated QA
 * (30+ min since WA receipt, photos categorized, data extracted)
 * and processes them through phases 1-4 programmatically.
 *
 * DRs are parked at phase 5 (feedback) for human review before
 * WhatsApp feedback is sent.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { findEligibleDRs, processOneDR, type AutoQaProcessResult } from '@/modules/activate/services/autoQaProcessor';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }

  // Always require bearer token regardless of environment
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('CRON_SECRET environment variable not configured', undefined, 'AutoQaCron');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: CRON_SECRET not set');
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${cronSecret}`) {
    log.error('Unauthorized request', undefined, 'AutoQaCron');
    return apiResponse.unauthorized(res, 'Invalid or missing cron secret');
  }

  const limit = Number(req.query.limit) || Number(req.body?.limit) || 10;

  log.info(`Starting auto-QA processing (limit: ${limit})`, undefined, 'AutoQaCron');

  try {
    const eligibleDRs = await findEligibleDRs(limit);

    if (eligibleDRs.length === 0) {
      log.info('No DRs eligible for auto-QA', undefined, 'AutoQaCron');
      return apiResponse.success(res, {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        results: [] as AutoQaProcessResult[],
        timestamp: new Date().toISOString(),
      });
    }

    log.info(`Found ${eligibleDRs.length} eligible DRs`, undefined, 'AutoQaCron');

    const results: AutoQaProcessResult[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    // Process sequentially (no VLM calls, just DB reads + in-memory logic)
    for (const dr of eligibleDRs) {
      const result = await processOneDR(dr.drop_number);
      results.push(result);

      if (result.skipped) {
        skipped++;
      } else if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    log.info(`Completed: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed`, undefined, 'AutoQaCron');

    return apiResponse.success(res, {
      processed: eligibleDRs.length,
      succeeded,
      failed,
      skipped,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`, undefined, 'AutoQaCron');
    return apiResponse.internalError(res, error);
  }
}
