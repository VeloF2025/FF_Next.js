/**
 * Nightly overnight-parking compliance check. Runs at 20:00 SAST from
 * velo's crontab — NOT vercel.json, because Vercel crons do not fire for
 * this systemd-hosted app.
 *
 * Cron (Velocity crontab — the secret is read from the env file, never inlined):
 *   0 20 * * * SECRET=$(grep "^CRON_SECRET=" /home/velo/fibreflow-dev/.env.local | cut -d= -f2) && curl -sf -m 120 -H "x-cron-secret: $SECRET" http://localhost:3005/api/cron/fleet-parking-check >> /home/velo/logs/fleet-parking-check.log 2>&1
 *
 * Thin by design: auth and HTTP only. All logic lives in
 * src/modules/fleet/parking/ so it can be tested without a server.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { runParkingCheck } from '@/modules/fleet/parking/runParkingCheck';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }

  // Mirrors pages/api/cron/poll-tracking.ts — fail closed when unset.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error('[fleet-parking-check] CRON_SECRET not configured — rejecting');
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Cron endpoint misconfigured');
  }
  if (req.headers['x-cron-secret'] !== expected) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  try {
    const report = await runParkingCheck(new Date());
    // Log only the summary — `results` is one entry per vehicle (~22/night)
    // and would otherwise flood the log every run.
    log.info('[fleet-parking-check] completed', {
      checkDate: report.checkDate,
      evaluated: report.evaluated,
      counts: report.counts,
      errors: report.errors,
    });
    return apiResponse.success(res, report);
  } catch (error) {
    log.error('[fleet-parking-check] run failed', { error });
    return apiResponse.internalError(res, error, 'Parking check failed');
  }
}
