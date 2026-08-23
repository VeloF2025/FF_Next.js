/**
 * POST /api/cron/fleet-operational-aggregate
 *
 * Rebuilds the monthly operational aggregates for the recalculation window.
 *
 * Unlike the retention endpoint this one takes no body: it only ever writes
 * anonymous aggregate rows and deletes nothing that is not its own previous
 * output, so there is no destructive mode to guard against and no flag that
 * could be got wrong.
 *
 * Auth matches this Fleet module's convention - `x-cron-secret`, as
 * `fleet-operational-monitor.ts` and `fleet-operational-retention.ts` - and
 * fails closed when unset.
 *
 * Schedule: 01:00 SAST via scripts/cron-fleet-operational-aggregate.sh, ahead
 * of retention at 03:30, because retention cannot purge a month this job has
 * not yet covered. Registering that crontab line is a deployment action
 * requiring its own approval.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { cronSecretMatches } from '@/lib/cronAuth';
import { log } from '@/lib/logger';
import { runWithCronLock } from '@/modules/fleet/incidents/cronLock';
import { aggregateOperationsMonths } from '@/modules/fleet/incidents/analytics/aggregationService';

const MODULE = 'FleetOperationalAggregateCron';
const CRON_LOCK_NAME = 'fleet-operational-aggregate';

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
    const outcome = await runWithCronLock(CRON_LOCK_NAME, () => aggregateOperationsMonths(requestedAt));
    if (!outcome.ran) {
      log.info('Another aggregation run holds the lock — skipping this tick', undefined, MODULE);
      return apiResponse.success(res, { skipped: true });
    }
    return apiResponse.success(res, { skipped: false, ...outcome.result });
  } catch (error) {
    // Deliberately not the raw message: a connection string in a cron log is a
    // credential leak.
    log.error('Fleet operational aggregation cron failed', {
      error: error instanceof Error ? error.name : 'unknown',
    }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Fleet operational aggregation cron failed');
  }
}
