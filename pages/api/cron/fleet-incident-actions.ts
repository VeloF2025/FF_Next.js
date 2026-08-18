/**
 * POST /api/cron/fleet-incident-actions
 *
 * Acknowledgement escalation, 08:15 SAST morning summary, and status-monitor
 * health checks for Fleet operational incidents (design §9). Thin wiring
 * over `runWithCronLock` (pinned-connection advisory lock, mirroring
 * `pages/api/cron/appeals-vlm.ts`) and `runIncidentActions` (escalation,
 * summary, and health orchestration — see actionRunner.ts).
 *
 * Auth matches `fleet-operational-monitor.ts` (Task 4)'s established
 * convention: `Authorization: Bearer <CRON_SECRET>`, fail-closed when unset.
 * This endpoint intentionally does not also accept `x-cron-secret` —
 * supporting two undocumented secret paths on one endpoint is exactly what
 * this repo's secret-handling rules forbid.
 *
 * Schedule: at least every 5 minutes via scripts/cron-fleet-incident-actions.sh.
 * Registering that schedule on velo's crontab is a deployment action
 * requiring separate approval — it is not done by this change.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { runWithCronLock } from '@/modules/fleet/incidents/cronLock';
import { runIncidentActions } from '@/modules/fleet/incidents/actionRunner';

const MODULE = 'FleetIncidentActionsCron';
const CRON_LOCK_NAME = 'fleet-incident-actions';

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
    const outcome = await runWithCronLock(CRON_LOCK_NAME, () => runIncidentActions({ requestedAt: now, effectiveAt: now }));

    if (!outcome.ran) {
      log.info('Another incident-actions run holds the lock — skipping this tick', undefined, MODULE);
      return apiResponse.success(res, { skipped: true });
    }

    return apiResponse.success(res, { skipped: false, ...outcome.result });
  } catch (err) {
    log.error('Fleet incident-actions cron failed', { err: err instanceof Error ? err.message : String(err) }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Fleet incident-actions cron failed');
  }
}
