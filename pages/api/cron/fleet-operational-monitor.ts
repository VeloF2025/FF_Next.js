/**
 * POST /api/cron/fleet-operational-monitor
 *
 * Five-minute Fleet operational-incident monitor (design §8.1). Thin wiring
 * over `runWithCronLock` (pinned-connection advisory lock, mirroring
 * `pages/api/cron/appeals-vlm.ts`) and `runOperationalMonitor` (roster load,
 * per-staff producer calls, run finalization — see monitorService.ts).
 *
 * Auth matches this Fleet module's own convention — `x-cron-secret`, same
 * as `fleet-parking-check.ts` and `fleet-check-reminders.ts` — rather than
 * this repo's `Authorization: Bearer <CRON_SECRET>` convention used
 * elsewhere (`appeals-vlm.ts`, `auto-qa.ts`, and others); a per-repo count
 * of actual header checks found `x-cron-secret` more common overall, and
 * mixing both conventions inside one module is worse than picking either
 * one consistently. Fail-closed when unset. This endpoint intentionally
 * does not also accept `Authorization: Bearer` — supporting two
 * undocumented secret paths on one endpoint is exactly what this repo's
 * secret-handling rules forbid.
 *
 * Two phases run per tick, in order, under ONE lock: the roster monitor, then
 * the vehicle telematics detectors. They share nothing but the tick instant, so
 * the second is wrapped in its own try/catch below and reports its own counters
 * — a telematics feed is a third party, and a detector fault must not mark the
 * roster monitor's run failed or lose its result. The detectors need no crontab
 * entry of their own for exactly this reason.
 *
 * Schedule: every 5 minutes via scripts/cron-fleet-operational-monitor.sh.
 * Registering that schedule on velo's crontab is a deployment action
 * requiring separate approval — it is not done by this change.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { cronSecretMatches } from '@/lib/cronAuth';
import { log } from '@/lib/logger';
import { runWithCronLock } from '@/modules/fleet/incidents/cronLock';
import { runOperationalMonitor } from '@/modules/fleet/incidents/monitorService';
import {
  runVehicleDetectors,
  vehicleDetectorPhaseFailure,
  type VehicleDetectorPhaseResult,
} from '@/modules/fleet/vehicleDetectors/vehicleDetectorService';

const MODULE = 'FleetOperationalMonitorCron';
const CRON_LOCK_NAME = 'fleet-operational-monitor';

/**
 * The detector phase, made unable to fail the tick.
 *
 * `runVehicleDetectors` already isolates per detector, per vehicle and per
 * produced event and reports what broke in its counters; this catch is for the
 * things it cannot contain — a failed rule load, a dead pool. Either way the
 * roster monitor's result is already computed and must still be returned.
 */
async function runDetectorPhase(now: string): Promise<VehicleDetectorPhaseResult> {
  try {
    return await runVehicleDetectors({ now });
  } catch (err) {
    log.error(
      'Fleet vehicle detector phase failed; the roster monitor result stands',
      { err: err instanceof Error ? err.message : String(err) },
      MODULE,
    );
    return vehicleDetectorPhaseFailure();
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', undefined, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: CRON_SECRET not set');
  }
  if (!cronSecretMatches(req.headers['x-cron-secret'], cronSecret)) {
    return apiResponse.unauthorized(res, 'Invalid or missing cron secret');
  }

  try {
    const now = new Date().toISOString();
    const outcome = await runWithCronLock(CRON_LOCK_NAME, async () => {
      const monitor = await runOperationalMonitor({ requestedAt: now, effectiveAt: now });
      // Strictly after the monitor: it opens the roster incidents this tick is
      // primarily for, and the detectors must not delay or endanger them.
      const vehicleDetectors = await runDetectorPhase(now);
      return { ...monitor, vehicleDetectors };
    });

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
