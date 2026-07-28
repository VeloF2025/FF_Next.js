/**
 * POST /api/cron/pp-reresolve
 *
 * Protected cron endpoint — runs the PP local-resolution scan so serials that
 * become identifiable after the import-time pass (e.g. onemap barcodes synced
 * later that night) flip from not_found to located_*. Reuses the exact
 * `runLocalResolution` used by the manual resolve action.
 *
 * Authentication: x-cron-secret: {CRON_SECRET}
 *
 * Scheduled 05:45 SAST (before the 06:00 group-nonactivation-report):
 *   curl -s -X POST https://app.fibreflow.app/api/cron/pp-reresolve \
 *     -H "x-cron-secret: $CRON_SECRET"
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
// Relative import: the resolver lives in a pages/api route (outside the @/ alias → ./src).
import { runLocalResolution } from '../activate/pp-data-resolve';

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', {}, 'pp-reresolve');
    return apiResponse.internalError(res, new Error('Server misconfiguration'));
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    log.warn(
      'Unauthorised pp-reresolve attempt',
      { ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '') },
      'pp-reresolve',
    );
    return apiResponse.unauthorized(res, 'Invalid or missing x-cron-secret header');
  }

  log.info('PP re-resolve triggered', {}, 'pp-reresolve');
  try {
    const result = await runLocalResolution();
    // A source that could not run resolves nothing while looking exactly like a
    // source that ran and matched nothing — so say so at ERROR, not by omission.
    if (result.failures.length > 0) {
      log.error(
        'PP re-resolve completed with unusable sources',
        { failed: result.failures.length, failures: result.failures },
        'pp-reresolve',
      );
    }
    log.info(
      'PP re-resolve complete',
      { resolved: result.total_resolved, failedSources: result.failures.length },
      'pp-reresolve',
    );
    return apiResponse.success(res, result, 'PP re-resolve complete');
  } catch (error: unknown) {
    log.error('PP re-resolve failed', { error: error instanceof Error ? error.message : String(error) }, 'pp-reresolve');
    return apiResponse.internalError(res, error, 'PP re-resolve failed');
  }
}
