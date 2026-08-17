/**
 * Nightly overnight-parking compliance check. Runs at 20:00 SAST from
 * velo's crontab — NOT vercel.json, because Vercel crons do not fire for
 * this systemd-hosted app.
 *
 * Registration is scripts/cron-fleet-parking-check.sh, which resolves the
 * secret and the port from the deploy dir's env file. Install with:
 *
 *   0 20 * * * /home/velo/fibreflow-production/scripts/cron-fleet-parking-check.sh >> /home/velo/logs/fleet-parking-check.log 2>&1
 *
 * Until that line is in velo's crontab this endpoint answers 200 to a manual
 * curl and the feature records nothing — silently, because an absent nightly
 * run raises no alert. `?date=YYYY-MM-DD` exists for exactly that case: it
 * re-runs the check as of 20:00 SAST on a past date, so a missed night can be
 * recovered from fleet_vehicle_positions rather than lost.
 *
 * Thin by design: auth and HTTP only. All logic lives in
 * src/modules/fleet/parking/ so it can be tested without a server.
 */
import { timingSafeEqual } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { runParkingCheck } from '@/modules/fleet/parking/runParkingCheck';
import { sastDateString } from '@/modules/fleet/parking/sastDate';
import { finalizeParkingRun, startParkingRun } from '@/modules/fleet/parking/runQueries';
import { notifyNewParkingViolations } from '@/modules/fleet/parking/violationNotifications';

/** Equal-length compare in constant time; unequal lengths cannot match anyway. */
function secretMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 20:00 SAST on the requested calendar date, or an error string.
 *
 * A rejected date stops the request — it never falls through to "now". A
 * backfill that silently re-ran tonight instead of the night asked for would
 * overwrite a good row with today's evidence.
 *
 * SAST is UTC+2 year-round (no DST), so the offset can be written literally.
 */
function resolveCheckAt(raw: unknown, now: Date): { checkAt: Date } | { error: string } {
  if (raw === undefined) return { checkAt: now };
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { error: 'date must be YYYY-MM-DD' };
  }
  const checkAt = new Date(`${raw}T20:00:00+02:00`);
  if (Number.isNaN(checkAt.getTime())) return { error: 'date is not a real calendar date' };
  // Rejects 2026-02-30, which Date would otherwise roll forward to 2026-03-02.
  if (sastDateString(checkAt) !== raw) return { error: 'date is not a real calendar date' };
  if (checkAt.getTime() > now.getTime()) return { error: 'date is in the future' };
  return { checkAt };
}

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
  if (!secretMatches(req.headers['x-cron-secret'], expected)) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  // Optional chain because `query` is only guaranteed by the Next runtime; a
  // request without one simply carries no date, which is the nightly case.
  const resolved = resolveCheckAt(req.query?.date, new Date());
  if ('error' in resolved) {
    return apiResponse.badRequest(res, resolved.error);
  }

  let runId: string | null = null;
  try {
    runId = await startParkingRun(sastDateString(resolved.checkAt), new Date());
    const report = await runParkingCheck(resolved.checkAt);
    const notification = await notifyNewParkingViolations(report);
    await finalizeParkingRun(runId, {
      status: report.errors === 0 && notification.warnings === 0 ? 'succeeded' : 'partial_failure',
      evaluatedCount: report.evaluated,
      violationCount: report.counts.violation,
      recordErrorCount: report.errors,
      notificationWarningCount: notification.warnings,
    });
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
    if (runId) {
      try {
        await finalizeParkingRun(runId, { status: 'failed', evaluatedCount: 0, violationCount: 0, recordErrorCount: 0, notificationWarningCount: 0, errorSummary: error instanceof Error ? error.message.slice(0, 500) : 'Parking check failed' });
      } catch (finalizeError) {
        log.error('[fleet-parking-check] failed to finalize failed run', { finalizeError });
      }
    }
    log.error('[fleet-parking-check] run failed', { error });
    return apiResponse.internalError(res, error, 'Parking check failed');
  }
}
