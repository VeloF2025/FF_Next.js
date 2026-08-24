/**
 * POST /api/cron/fleet-build-trips
 *
 * Segments new positions into trips for every vehicle that has any. Incremental: each vehicle
 * resumes from its own watermark, so a tick costs roughly what arrived since the last one.
 *
 * Takes no body. It only writes trips derived from positions and deletes nothing, so there is no
 * destructive mode to guard and no flag that could be got wrong.
 *
 * Auth matches this Fleet module's convention -- x-cron-secret, as fleet-operational-monitor.ts
 * and fleet-operational-aggregate.ts -- and fails closed when the secret is unset.
 *
 * Schedule: every 15 minutes via scripts/cron-fleet-build-trips.sh. Registering that crontab line
 * is a deployment action requiring its own approval.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { cronSecretMatches } from '@/lib/cronAuth';
import { log } from '@/lib/logger';
import { runWithCronLock } from '@/modules/fleet/incidents/cronLock';
import { buildTrips } from '@/modules/fleet/trips/tripBuildService';

const MODULE = 'FleetBuildTripsCron';
const CRON_LOCK_NAME = 'fleet-build-trips';

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
    const outcome = await runWithCronLock(CRON_LOCK_NAME, () => buildTrips(requestedAt));
    if (!outcome.ran) {
      log.info('Another trip build holds the lock — skipping this tick', undefined, MODULE);
      return apiResponse.success(res, { skipped: true });
    }
    return apiResponse.success(res, { skipped: false, ...outcome.result });
  } catch (error) {
    // Deliberately not the raw message: a connection string in a cron log is a credential leak.
    log.error('Fleet trip build cron failed', {
      error: error instanceof Error ? error.name : 'unknown',
    }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Fleet trip build cron failed');
  }
}
