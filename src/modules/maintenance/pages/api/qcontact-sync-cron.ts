/**
 * QContact Sync Cron Endpoint
 * 🟢 WORKING: Production-ready API endpoint for automated QContact sync
 *
 * Usage:
 * - Called by Vercel Cron (configured in vercel.json)
 * - Protected by CRON_SECRET environment variable
 * - Executes full bidirectional sync with QContact
 *
 * Cron Schedule: Every 15 minutes
 *
 * curl -X POST \
 *   -H "Authorization: Bearer YOUR_CRON_SECRET" \
 *   https://app.fibreflow.app/api/qcontact-sync-cron
 *
 * @module api/qcontact-sync-cron
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { runSyncJob } from '@/modules/ticketing/jobs/qcontactSync';
import { createLogger } from '@/lib/logger';

// 🟢 WORKING: Logger instance for cron endpoint
const logger = createLogger('qcontactSyncCron');

/**
 * Cron endpoint handler
 * 🟢 WORKING: Handles cron-triggered sync jobs
 *
 * Security:
 * - Requires Bearer token matching CRON_SECRET
 * - Only accepts POST requests
 *
 * Response Format:
 * Success: 200 with sync statistics
 * Auth Error: 401 Unauthorized
 * Method Error: 405 Method Not Allowed
 * Sync Error: 500 with error details (but job still logged)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check authorization
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error('CRON_SECRET not configured');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('Unauthorized cron attempt', {
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    logger.info('Starting QContact sync cron job', {
      timestamp: new Date().toISOString(),
      trigger: 'vercel-cron',
    });

    // Run sync job
    const result = await runSyncJob();

    logger.info('QContact sync cron job completed', {
      job_id: result.job_id,
      status: result.status,
      duration_seconds: result.duration_seconds,
      total_success: result.sync_result?.total_success || 0,
      total_failed: result.sync_result?.total_failed || 0,
      success_rate: result.sync_result?.success_rate || 0,
    });

    // Return success response (even for partial failures)
    return res.status(200).json({
      success: true,
      job_id: result.job_id,
      status: result.status,
      timestamp: new Date().toISOString(),
      duration_seconds: result.duration_seconds,
      inbound_processed: result.sync_result?.inbound_stats.total_processed || 0,
      inbound_created: result.sync_result?.inbound_stats.created || 0,
      inbound_updated: result.sync_result?.inbound_stats.updated || 0,
      outbound_processed: result.sync_result?.outbound_stats.total_processed || 0,
      outbound_updated: result.sync_result?.outbound_stats.updated || 0,
      total_success: result.sync_result?.total_success || 0,
      total_failed: result.sync_result?.total_failed || 0,
      success_rate: result.sync_result?.success_rate || 0,
      error_count: result.sync_result?.errors?.length || 0,
      message: `QContact sync ${result.status}: ${result.sync_result?.total_success || 0} successful, ${result.sync_result?.total_failed || 0} failed`,
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('QContact sync cron job failed', {
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Return error response
    return res.status(500).json({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
}
