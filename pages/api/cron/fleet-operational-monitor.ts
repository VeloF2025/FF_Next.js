/**
 * POST /api/cron/fleet-operational-monitor
 *
 * Five-minute Fleet operational-incident monitor (design §8.1). Thin wiring
 * over `runWithCronLock` (pinned-connection advisory lock, mirroring
 * `pages/api/cron/appeals-vlm.ts`) and `runOperationalMonitor` (roster load,
 * per-staff producer calls, run finalization — see monitorService.ts).
 *
 * Auth matches this repo's dominant cron convention (`appeals-vlm.ts`,
 * `auto-qa.ts`, `backfill-onemap-data.ts`, `action-centre-rules.ts`, and
 * others): `Authorization: Bearer <CRON_SECRET>`, fail-closed when unset.
 * A minority of cron endpoints in this repo instead use `x-cron-secret`;
 * this endpoint intentionally does not accept that header too — supporting
 * two undocumented secret paths on one endpoint is exactly what this repo's
 * secret-handling rules forbid.
 *
 * Schedule: every 5 minutes via scripts/cron-fleet-operational-monitor.sh.
 * Registering that schedule on velo's crontab is a deployment action
 * requiring separate approval — it is not done by this change.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { runWithCronLock } from '@/modules/fleet/incidents/cronLock';
import { runOperationalMonitor } from '@/modules/fleet/incidents/monitorService';

const MODULE = 'FleetOperationalMonitorCron';
const CRON_LOCK_NAME = 'fleet-operational-monitor';

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', undefined, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: CRON_SECRET not set');
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return apiResponse.unauthorized(res, 'Invalid or missing cron secret');
  }

  try {
    const now = new Date().toISOString();
    const outcome = await runWithCronLock(CRON_LOCK_NAME, () => runOperationalMonitor({ requestedAt: now, effectiveAt: now }));

    if (!outcome.ran) {
      log.info('Another operational monitor run holds the lock — skipping this tick', undefined, MODULE);
      return apiResponse.success(res, { skipped: true });
    }

    return apiResponse.success(res, { skipped: false, ...outcome.result });
  } catch (err) {
    log.error('Fleet operational monitor cron failed', { err: err instanceof Error ? err.message : String(err) }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Fleet operational monitor cron failed');
  }
}
