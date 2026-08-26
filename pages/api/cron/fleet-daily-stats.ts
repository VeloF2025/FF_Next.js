/**
 * POST /api/cron/fleet-daily-stats
 *
 * Folds new positions into one `fleet_vehicle_daily_stats` row per vehicle per SAST calendar day.
 * Incremental: each vehicle resumes from its own watermark, snapped back to a day boundary, so a
 * tick costs roughly what arrived since the last one plus today and yesterday.
 *
 * Takes no body. Every write is a full replacement of a row derived from positions, and nothing is
 * deleted, so there is no destructive mode to guard and no flag that could be got wrong. Safe to
 * run often; safe to miss a run.
 *
 * A tick that leaves backlog still answers `status: 'succeeded'`. The wrapper exits non-zero on
 * any other status, and backlog is the ordinary state of a vehicle catching up -- every vehicle
 * holds weeks of it the first time this runs. The count is in `vehiclesWithBacklog`, which the
 * wrapper echoes with the rest of the body on every tick, and in a warn line from the build
 * service. Backlog that stops SHRINKING is what deserves an alert, and that comparison needs the
 * previous tick's number, which a stateless wrapper does not have.
 *
 * Auth matches this Fleet module's convention -- x-cron-secret, as fleet-build-trips.ts and
 * fleet-operational-monitor.ts -- and fails closed when the secret is unset.
 *
 * Schedule: every 15 minutes via scripts/cron-fleet-daily-stats.sh, on PRODUCTION ONLY. Two
 * instances would fight over the same watermark rows against the one shared database. Registering
 * that crontab line is a deployment action requiring its own approval.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { cronSecretMatches } from '@/lib/cronAuth';
import { log } from '@/lib/logger';
import { runWithCronLock } from '@/modules/fleet/incidents/cronLock';
import { buildDailyStats, DAILY_STATS_LOCK } from '@/modules/fleet/dailyStats/dailyStatsBuildService';

const MODULE = 'FleetDailyStatsCron';

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
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
    const requestedAt = new Date().toISOString();
    const outcome = await runWithCronLock(DAILY_STATS_LOCK, () => buildDailyStats(requestedAt));
    if (!outcome.ran) {
      log.info('Another daily-stats build holds the lock — skipping this tick', undefined, MODULE);
      return apiResponse.success(res, { skipped: true });
    }
    return apiResponse.success(res, { skipped: false, ...outcome.result });
  } catch (error) {
    // Deliberately not the raw message: a connection string in a cron log is a credential leak.
    log.error('Fleet daily stats cron failed', {
      error: error instanceof Error ? error.name : 'unknown',
    }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Fleet daily stats cron failed');
  }
}
