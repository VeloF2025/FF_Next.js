/**
 * POST /api/fibertime/oes-sync
 *
 * Protected cron endpoint — pulls daily OES reports from Fibertime SharePoint
 * into FibreFlow's OES import pipeline.
 *
 * Authentication: Authorization: Bearer {CRON_SECRET}
 *
 * Called nightly at 22:30 SAST by a Velocity cron job:
 *   curl -s -X POST https://app.fibreflow.app/api/fibertime/oes-sync \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Optional body: { "date": "YYYYMMDD" } — defaults to today SAST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { runOesSync } from '@/services/fibertime-oes-sync';
import { FibertimeAuthExpiredError } from '@/lib/sharepoint/fibertime-sp-client';

const logger = createLogger('api:fibertime/oes-sync');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  // ---- Auth ----------------------------------------------------------------
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured');
    return apiResponse.internalError(res, new Error('Server misconfiguration'));
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('Unauthorised OES sync attempt', {
      ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? ''),
    });
    return apiResponse.unauthorized(res, 'Invalid or missing Authorization header');
  }

  // ---- Run sync ------------------------------------------------------------
  try {
    const date =
      typeof req.body?.date === 'string' && /^\d{8}$/.test(req.body.date)
        ? (req.body.date as string)
        : undefined;

    logger.info('Fibertime OES sync triggered', { date: date ?? 'today (SAST)' });

    const report = await runOesSync(date);

    return apiResponse.success(res, report, 'OES sync complete');
  } catch (error: unknown) {
    if (error instanceof FibertimeAuthExpiredError) {
      logger.error('Fibertime SharePoint session expired', { error: error.message });
      res.status(503).json({
        success: false,
        error: 'Fibertime SharePoint session expired',
        message: error.message,
        action: 'Run scripts/fibertime-sp-login.ts on the Velocity server to refresh cookies',
      });
      return;
    }
    logger.error('Fibertime OES sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return apiResponse.internalError(res, error, 'OES sync failed');
  }
}
