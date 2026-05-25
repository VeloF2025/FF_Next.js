/**
 * Cron Job: Nightly Serial Recheck
 *
 * POST /api/cron/serial-recheck
 *
 * Silently adjudicates recent ONT/UPS serial mismatches (forward-looking,
 * last N days). ONT vs OES (auto-correct to OES). UPS via VLM 2nd-pass
 * (auto-correct slam-dunks, queue ambiguous for vision). Sends NO WhatsApp.
 *
 * Schedule: nightly, after-hours SAST. Query params: ?days=7&upsLimit=100
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { runSerialRecheckBatch } from '@/modules/activate/services/serialRecheckBatchService';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  // Verify cron secret unconditionally — dev shares the production database.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', undefined, 'SerialRecheckCron');
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    log.error('Unauthorized serial-recheck cron request', undefined, 'SerialRecheckCron');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const lookbackDays = Math.min(Number(req.query.days) || 7, 30);
  const upsLimit = Math.min(Number(req.query.upsLimit) || 100, 500);

  try {
    const summary = await runSerialRecheckBatch({ lookbackDays, upsLimit });
    return apiResponse.success(res, { ...summary, timestamp: new Date().toISOString() });
  } catch (error) {
    log.error('Serial recheck cron failed', { error }, 'SerialRecheckCron');
    return apiResponse.internalError(res, error instanceof Error ? error : new Error(String(error)));
  }
}

export default handler;
