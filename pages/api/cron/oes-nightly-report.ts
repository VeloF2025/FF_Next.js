/**
 * POST /api/cron/oes-nightly-report
 *
 * Protected cron endpoint — generates the daily OES Excel report and
 * posts it to the Velocity Activations WhatsApp group.
 *
 * Authentication: x-cron-secret: {CRON_SECRET}
 *
 * Called every morning at 07:00 SAST (05:00 UTC) by a Velocity cron job:
 *   curl -s -X POST https://app.fibreflow.app/api/cron/oes-nightly-report \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Optional body: { "dryRun": true } — generates and uploads the report but
 * skips the WhatsApp send. Useful for manual verification.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { runNightlyOesReport } from '@/services/oesNightlyReport';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', {}, 'oes-nightly-report');
    return apiResponse.internalError(res, new Error('Server misconfiguration'));
  }

  if (req.headers['x-cron-secret'] !== cronSecret) {
    log.warn('Unauthorised OES nightly report attempt', {
      ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? ''),
    }, 'oes-nightly-report');
    return apiResponse.unauthorized(res, 'Invalid or missing x-cron-secret header');
  }

  const dryRun = req.body?.dryRun === true;
  const date =
    typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
      ? (req.body.date as string)
      : undefined;

  log.info('OES nightly report triggered', { dryRun, date: date ?? 'today (SAST)' }, 'oes-nightly-report');

  try {
    const result = await runNightlyOesReport({ date, dryRun });
    return apiResponse.success(res, result, dryRun ? 'OES report generated (dry run)' : 'OES report sent');
  } catch (error: unknown) {
    log.error('OES nightly report failed', {
      error: error instanceof Error ? error.message : String(error),
    }, 'oes-nightly-report');
    return apiResponse.internalError(res, error, 'OES nightly report failed');
  }
}
