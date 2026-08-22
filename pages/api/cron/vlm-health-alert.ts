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

/**
 * How far back the gate counts. At the 5-minute cadence this is a 25-minute
 * window.
 *
 * A WINDOW, not a consecutive run — the distinction is load-bearing. A VLM
 * flapping down/up/down/up is genuinely half down, but a consecutive counter
 * resets on every healthy tick, never reaches the threshold, and so pages
 * nobody at all. That is worse than the outage this file was written for,
 * because it fails silently for as long as the flapping lasts.
 *
 * The sibling wa-bridge-health monitor hit exactly this and was retuned from a
 * consecutive run to 3-of-5 (661429226, f79d34b37). Same shape here, for the
 * same reason.
 */
export const FAILED_WINDOW_TICKS = 5;

/** While still down, re-page at most this often (ticks). 12 x 5min = 1 hour. */
const REMINDER_EVERY_TICKS = 12;

/**
 * Module-level state. Resets on deploy, which is acceptable: a deploy during an
 * outage costs at most one repeated page, and the alternative (a state table)
 * adds a DB dependency to the one endpoint that must keep working when things
 * are broken.
 */
/**
 * Whether each of the last FAILED_WINDOW_TICKS probes failed, oldest first.
 * Bounded, so it cannot grow across a long-running process.
 */
let failureWindow: boolean[] = [];
/** Ticks observed failing since the outage began — reported, not used to gate. */
let failedTicks = 0;
let ticksSinceLastPage = 0;
let alerted = false;

/** Exported for tests — there is no other way to reset module state. */
export function __resetVlmAlertState(): void {
  failureWindow = [];
  failedTicks = 0;
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
    const downForTicks = failedTicks;

    // A healthy tick is RECORDED in the window, not a reset of it. Wiping the
    // window here is precisely what makes a flapping service invisible: every
    // recovery tick would erase the evidence of the failures around it.
    failureWindow = [...failureWindow, false].slice(-FAILED_WINDOW_TICKS);
    const failuresInWindow = failureWindow.filter(Boolean).length;

    // Only a window that has actually drained counts as recovery. While
    // failures are still inside it the service is flapping, not restored, so
    // the alert state stands and a later tick can still page.
    if (failuresInWindow === 0) {
      failedTicks = 0;
      ticksSinceLastPage = 0;
      alerted = false;
    }

    if (wasAlerted && failureWindow.filter(Boolean).length === 0) {
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
      recovered: wasAlerted && failureWindow.filter(Boolean).length === 0,
      failuresInWindow: failureWindow.filter(Boolean).length,
      alerted: false,
    });
  }

  // ---- Still / newly down -------------------------------------------------
  failedTicks += 1;
  failureWindow = [...failureWindow, true].slice(-FAILED_WINDOW_TICKS);
  const failuresInWindow = failureWindow.filter(Boolean).length;
  const reason = health.error ?? 'no models served';

  // Below the gate: log only. A single stalled probe is not an outage.
  if (failuresInWindow < FAILED_TICKS_BEFORE_ALERT) {
    log.warn(
      `VLM probe failed (${failuresInWindow}/${FAILED_TICKS_BEFORE_ALERT} in the last ${FAILED_WINDOW_TICKS} ticks): ${reason}`,
      undefined,
      MODULE
    );
    return apiResponse.success(res, {
      available: false,
      error: reason,
      failedTicks,
      failuresInWindow,
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
      failedTicks,
      failuresInWindow,
      alerted: false,
    });
  }

  const minutes = failedTicks * 5;
  const dispatch = await dispatchBridgeAlert(
    firstPage ? 'VLM IS DOWN — activate pipeline stalled' : 'VLM STILL DOWN',
    [
      `The VLM has failed ${failuresInWindow} of the last ${FAILED_WINDOW_TICKS} health probes (~${minutes} minutes since the first failure).`,
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
  // Mark as paged ONLY if a channel actually took it. Setting this optimistically
  // before the dispatch resolves means a tick where email AND WhatsApp both fail
  // — likeliest during a real outage, when both are under stress — records a page
  // nobody received and then suppresses retries for a full REMINDER_EVERY_TICKS
  // hour. On total delivery failure we leave `alerted` alone so the next tick
  // tries again.
  const delivered = dispatch.delivered.length > 0;
  if (delivered) {
    alerted = true;
    ticksSinceLastPage = 0;
    log.error(`VLM down for ~${minutes} minutes: ${reason}`, undefined, MODULE);
  } else {
    log.error(
      `VLM down for ~${minutes} minutes and the page could not be delivered: ${reason}`,
      { problems: dispatch.problems },
      MODULE
    );
  }

  return apiResponse.success(res, {
    available: false,
    error: reason,
    failedTicks,
    failuresInWindow,
    alerted: delivered,
    deliveryProblems: dispatch.problems,
  });
}
