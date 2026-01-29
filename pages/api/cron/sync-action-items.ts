import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';

/**
 * Vercel Cron Job: Sync Action Items from Fireflies Meetings
 *
 * Runs every 6 hours to extract new action items from meetings.
 *
 * Vercel Cron documentation:
 * https://vercel.com/docs/cron-jobs
 *
 * Runs at: 00:00, 06:00, 12:00, 18:00 UTC
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
      log.error('cronTask', { action: 'sync-action-items', error: 'Unauthorized request' });
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  log.debug('cronTask', { action: 'sync-action-items', step: 'start' });

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3005';

    // STEP 1: Sync meetings from Fireflies API
    log.debug('cronTask', { action: 'sync-action-items', step: 'sync-meetings', baseUrl });
    const meetingsResponse = await fetch(`${baseUrl}/api/meetings?action=sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const meetingsResult = await meetingsResponse.json();

    if (!meetingsResponse.ok) {
      log.error('cronTask', { action: 'sync-action-items', step: 'sync-meetings', error: meetingsResult });
      return res.status(500).json({
        success: false,
        error: 'Meetings sync failed',
        details: meetingsResult,
      });
    }

    log.debug('cronTask', { action: 'sync-action-items', step: 'sync-meetings', synced: meetingsResult.synced });

    // STEP 2: Extract action items from meetings
    log.debug('cronTask', { action: 'sync-action-items', step: 'extract-action-items' });
    const actionItemsResponse = await fetch(`${baseUrl}/api/action-items/extract-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const actionItemsResult = await actionItemsResponse.json();

    if (!actionItemsResponse.ok) {
      log.error('cronTask', { action: 'sync-action-items', step: 'extract-action-items', error: actionItemsResult });
      return res.status(500).json({
        success: false,
        error: 'Action items extraction failed',
        details: actionItemsResult,
      });
    }

    log.debug('cronTask', { action: 'sync-action-items', step: 'complete', actionItemsCount: actionItemsResult.data?.length });

    return res.status(200).json({
      success: true,
      message: 'Full sync completed successfully',
      data: {
        meetings: meetingsResult,
        action_items: actionItemsResult.data,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('cronTask', { action: 'sync-action-items', error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
