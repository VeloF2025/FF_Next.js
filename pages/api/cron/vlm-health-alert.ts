/**
 * VLM health monitor cron.
 * GET/POST /api/cron/vlm-health-alert
 *
 * On 2026-08-20 the vLLM service stopped at 09:15:56 SAST and every restart
 * afterwards died with "Failed to infer device type". It stayed down until
 * 08:40 the next morning — 23h 25m. Nobody was told.
 *
 * The existing guard, /home/velo/scripts/vllm/health-check.sh, did notice: it
 * restarts the service every 5 minutes and logs "ERROR: Service failed to
 * restart properly" when that fails. It wrote that line for 23 hours into
 * /var/log/vllm-maintenance.log and no human ever reads that file. Detection
 * without delivery is not monitoring.
 *
 * The cost of the silence was not the outage itself — it was that photo
 * categorization failed for 93 DRs, which blocked auto-QA, which blocked
 * auto-feedback, so a full day of technicians got no feedback on their
 * installs. The VLM is the head of that chain; when it is down the whole
 * activate pipeline is down.
 *
 * Schedule (velo crontab, every 5 minutes):
 *   star/5 * * * * curl -s http://localhost:3000/api/cron/vlm-health-alert \
 *     -H "Authorization: Bearer $CRON_SECRET" >> /tmp/vlm-health-alert.log 2>&1
 *
 * Use localhost, not app.fibreflow.app: Cloudflare 403s non-browser clients.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { checkVlmHealth } from '@/lib/vlm/config';
import { dispatchBridgeAlert } from '@/lib/wa-bridge-health/alert';

const MODULE = 'VlmHealthAlert';

/**
 * Consecutive failed ticks before paging. At a 5-minute cadence this is 15
 * minutes of continuous failure.
 *
 * Not 1: the nightly 03:00 restart takes the API offline while the model loads
 * — measured at 2m23s on 2026-08-20 (03:00:32 stop -> 03:02:55 serving) — and
 * paging on every routine restart is how a monitor gets muted. 3 ticks clears
 * that window with margin.
 *
 * Not higher: the failure this exists to catch ran for 23 hours, so the
 * detection cost of 15 minutes is negligible against it, while every extra tick
 * is real feedback the technicians do not get.
 */
const FAILED_TICKS_BEFORE_ALERT = 3;

/** While still down, re-page at most this often (ticks). 12 x 5min = 1 hour. */
const REMINDER_EVERY_TICKS = 12;

/**
 * Module-level state. Resets on deploy, which is acceptable: a deploy during an
 * outage costs at most one repeated page, and the alternative (a state table)
 * adds a DB dependency to the one endpoint that must keep working when things
 * are broken.
 */
let consecutiveFailures = 0;
let ticksSinceLastPage = 0;
let alerted = false;

/** Exported for tests — there is no other way to reset module state. */
export function __resetVlmAlertState(): void {
  consecutiveFailures = 0;
  ticksSinceLastPage = 0;
  alerted = false;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
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

  const health = await checkVlmHealth();

  // ---- Recovered ---------------------------------------------------------
  if (health.available) {
    const wasAlerted = alerted;
    const downForTicks = consecutiveFailures;
    __resetVlmAlertState();

    if (wasAlerted) {
      const minutes = downForTicks * 5;
      await dispatchBridgeAlert(
        'RECOVERED: VLM is serving again',
        [
          `The VLM at /v1/models is answering again, serving ${health.model ?? 'an unknown model'}.`,
          `It was failing for approximately ${minutes} minutes.`,
          '',
          'Check for DRs stranded during the outage — photo categorization failures',
          'block auto-QA and therefore technician feedback:',
          '  SELECT count(*) FROM dr_photo_unified_reviews',
          "   WHERE vlm_categorization_status = 'failed' AND feedback_sent = false;",
        ].join('\n')
      );
      log.warn(`VLM recovered after ~${minutes} minutes`, { model: health.model }, MODULE);
    }

    return apiResponse.success(res, {
      available: true,
      model: health.model,
      recovered: wasAlerted,
      alerted: false,
    });
  }

  // ---- Still / newly down -------------------------------------------------
  consecutiveFailures += 1;
  const reason = health.error ?? 'no models served';

  // Below the gate: log only. A single stalled probe is not an outage.
  if (consecutiveFailures < FAILED_TICKS_BEFORE_ALERT) {
    log.warn(
      `VLM probe failed (${consecutiveFailures}/${FAILED_TICKS_BEFORE_ALERT}): ${reason}`,
      undefined,
      MODULE
    );
    return apiResponse.success(res, {
      available: false,
      error: reason,
      consecutiveFailures,
      alerted: false,
    });
  }

  // Gate passed. Page on the first crossing, then at most hourly.
  const firstPage = !alerted;
  ticksSinceLastPage += 1;
  const dueForReminder = alerted && ticksSinceLastPage >= REMINDER_EVERY_TICKS;

  if (!firstPage && !dueForReminder) {
    return apiResponse.success(res, {
      available: false,
      error: reason,
      consecutiveFailures,
      alerted: false,
    });
  }

  alerted = true;
  ticksSinceLastPage = 0;

  const minutes = consecutiveFailures * 5;
  await dispatchBridgeAlert(
    firstPage ? 'VLM IS DOWN — activate pipeline stalled' : 'VLM STILL DOWN',
    [
      `The VLM has failed ${consecutiveFailures} consecutive health probes (~${minutes} minutes).`,
      `Last error: ${reason}`,
      '',
      'Impact: photo categorization is failing. Auto-QA only runs on categorized',
      'DRs, and auto-feedback only runs on auto-QA\'d DRs — so technicians are',
      'receiving no feedback on their installs while this is down.',
      '',
      'On velo:',
      '  systemctl status vllm-qwen.service',
      '  journalctl -u vllm-qwen.service -n 50',
    ].join('\n')
  );
  log.error(`VLM down for ~${minutes} minutes: ${reason}`, undefined, MODULE);

  return apiResponse.success(res, {
    available: false,
    error: reason,
    consecutiveFailures,
    alerted: true,
  });
}
