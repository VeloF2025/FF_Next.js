import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';

/**
 * Vercel Cron Job: Process OneMap Serial Sync Queue
 *
 * Processes pending items in the onemap_sync_queue table.
 * The queue is automatically populated by a database trigger when new drops
 * are inserted into qa_photo_reviews (i.e., when DR is submitted to WA Monitor).
 *
 * This cron job runs every 5 minutes to ensure any pending syncs are processed,
 * including retries for failed attempts.
 *
 * Vercel Cron documentation:
 * https://vercel.com/docs/cron-jobs
 *
 * Runs at: Every 5 minutes
 * See vercel.json for cron schedule configuration
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is called by Vercel Cron
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  // In production, verify the cron secret
  if (process.env.NODE_ENV === 'production' && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      log.error('cronTask', { action: 'sync-onemap-serials', error: 'Unauthorized request' });
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  log.debug('cronTask', { action: 'sync-onemap-serials', step: 'start' });

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    // Call the queue processor
    const response = await fetch(`${baseUrl}/api/onemap/process-sync-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 20, // Process up to 20 items per run
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      log.error('cronTask', { action: 'sync-onemap-serials', error: result });
      return res.status(500).json({
        success: false,
        error: 'Queue processing failed',
        details: result,
      });
    }

    log.debug('cronTask', {
      action: 'sync-onemap-serials',
      step: 'complete',
      processed: result.data.processed,
      succeeded: result.data.succeeded,
      failed: result.data.failed
    });

    return res.status(200).json({
      success: true,
      message: 'OneMap sync queue processed',
      data: result.data,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('cronTask', { action: 'sync-onemap-serials', error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
