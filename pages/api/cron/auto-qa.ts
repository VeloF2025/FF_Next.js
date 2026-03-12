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
import { log } from '@/lib/logger';
import { findEligibleDRs, processOneDR, type AutoQaProcessResult } from '@/modules/activate/services/autoQaProcessor';

interface AutoQaResponse {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: AutoQaProcessResult[];
  timestamp: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AutoQaResponse | { error: string }>
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret in production
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production' && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      log.error('AutoQaCron', 'Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const limit = Number(req.query.limit) || Number(req.body?.limit) || 10;

  log.info('AutoQaCron', `Starting auto-QA processing (limit: ${limit})`);

  try {
    const eligibleDRs = await findEligibleDRs(limit);

    if (eligibleDRs.length === 0) {
      log.info('AutoQaCron', 'No DRs eligible for auto-QA');
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

    log.info('AutoQaCron', `Found ${eligibleDRs.length} eligible DRs`);

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

    log.info('AutoQaCron', `Completed: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed`);

    return res.status(200).json({
      success: true,
      processed: eligibleDRs.length,
      succeeded,
      failed,
      skipped,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('AutoQaCron', `Fatal error: ${errMsg}`);
    return res.status(500).json({ error: errMsg });
  }
}
