/**
 * POST /api/cron/fleet-operational-retention
 *
 * Runs one retention pass: dry (report only) or live (delete). `dryRun` is a
 * REQUIRED boolean in the body — there is no default, because the only safe
 * default for an endpoint that destroys evidence is "refuse". A malformed
 * body, a missing field, or the string "false" all get a 400 rather than a
 * live run, and a live run additionally needs `live_retention_enabled` in the
 * effective settings (409 otherwise).
 *
 * Auth matches this Fleet module's convention — `x-cron-secret`, as
 * `fleet-operational-monitor.ts` — and fails closed when unset.
 *
 * Schedule: 03:30 SAST via scripts/cron-fleet-operational-retention.sh, which
 * sends dry-run only. Registering that crontab line, and later enabling live
 * retention, are deployment actions requiring their own approval.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { cronSecretMatches } from '@/lib/cronAuth';
import { log } from '@/lib/logger';
import { runWithCronLock } from '@/modules/fleet/incidents/cronLock';
import { LiveRetentionDisabledError, runOperationalRetention } from '@/modules/fleet/incidents/retention/retentionService';

const MODULE = 'FleetOperationalRetentionCron';
const CRON_LOCK_NAME = 'fleet-operational-retention';

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

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as Record<string, unknown>).dryRun !== 'boolean') {
    return apiResponse.badRequest(res, 'dryRun must be an explicit boolean — retention never defaults to deleting');
  }
  const dryRun = (body as { dryRun: boolean }).dryRun;

  try {
    const requestedAt = new Date().toISOString();
    const outcome = await runWithCronLock(CRON_LOCK_NAME, () => runOperationalRetention({ dryRun, requestedAt }));
    if (!outcome.ran) {
      log.info('Another retention run holds the lock — skipping this tick', undefined, MODULE);
      return apiResponse.success(res, { skipped: true });
    }
    return apiResponse.success(res, { skipped: false, ...outcome.result });
  } catch (error) {
    if (error instanceof LiveRetentionDisabledError) {
      return apiResponse.conflict(res, 'Live retention is disabled in the effective Fleet analytics settings');
    }
    // Deliberately not the raw message: a connection string or storage URL in
    // a cron log is a credential leak.
    log.error('Fleet operational retention cron failed', {
      dryRun, error: error instanceof Error ? error.name : 'unknown',
    }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Fleet operational retention cron failed');
  }
}
