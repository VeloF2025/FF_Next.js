/**
 * WhatsApp bridge health monitor cron.
 * GET /api/cron/wa-bridge-health
 *
 * On 2026-07-30 WhatsApp logged the bridge device out at 11:15 SAST. Nobody was
 * told for 80 minutes. Three guards had been switched off the previous day and
 * the one monitor still running watches a different bridge entirely.
 *
 * This runs on velo, deliberately OFF the VPS, so it still fires when the VPS
 * itself is unreachable — the 2026-07-28 failure mode, where the box was powered
 * off through the whole 06:00 window and every send was lost silently.
 *
 * Schedule (velo crontab, every 5 minutes):
 *   star/5 * * * * curl -s http://localhost:3000/api/cron/wa-bridge-health \
 *     -H "x-cron-secret: $CRON_SECRET" >> /tmp/wa-bridge-health.log 2>&1
 *
 * `-s`, NOT `-sf`: an alerting tick answers 503, and `curl -f` discards the
 * body on non-2xx — so with `-f` the one log line worth having is the one that
 * never gets written.
 *
 * Use localhost, not app.fibreflow.app: Cloudflare 403s non-browser clients.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { dispatchBridgeAlert } from '@/lib/wa-bridge-health/alert';
import {
  buildBridgeAlert,
  classifyBridgeHealth,
  isAlerting,
  type BridgeHealthPayload,
  type BridgeVerdict,
} from '@/lib/wa-bridge-health/monitor';
import { probeBridgeHealth } from '@/lib/wa-bridge-health/probe';

/**
 * How many `unreachable` ticks inside UNREACHABLE_WINDOW_TICKS before paging.
 *
 * The retrying probe already absorbs a single stalled request. This gate covers
 * the case where a whole tick's worth of attempts fails at once — still far more
 * likely to be the velo -> VPS path than a dead bridge, on the evidence: 124
 * `unreachable` verdicts between 2026-08-03 and 2026-08-20, and the bridge's own
 * on-box healthcheck logged `healthy` for every one of them.
 *
 * The cost is honest and must not be glossed over: a genuinely dead VPS is now
 * reported one tick later, up to 5 minutes. Set against the failures this
 * monitor exists to catch — 80 minutes on 2026-07-30, a whole 06:00 window on
 * 2026-07-28 — 5 minutes is cheap, and 124 false pages that each claimed field
 * work was being lost is not.
 *
 * The gate applies to `unreachable` ALONE. `logged_out` and `disconnected` mean
 * the bridge answered and described its own state, which is authoritative and
 * pages on the first tick exactly as before.
 *
 * A WINDOW, not a consecutive run. Requiring consecutive ticks looks equivalent
 * and is not: a bridge alternating unreachable/healthy every tick — genuinely
 * half down — resets the run on every healthy tick and would never reach the
 * threshold, so it would never page at all. That is a worse failure than the one
 * being fixed, because the old code at least paged. Counting within a short
 * window catches the flap on its second failure while still ignoring the
 * isolated blips that produced all 124 false pages: those were minutes to hours
 * apart, not two inside ten.
 */
const UNREACHABLE_TICKS_BEFORE_ALERT = 2;

/**
 * How far back the gate counts, in ticks. At the cron's 5-minute cadence this is
 * a 15-minute window, so a flapping bridge pages within 10 minutes while two
 * blips a quarter-hour apart still do not.
 */
const UNREACHABLE_WINDOW_TICKS = 3;

/**
 * Re-alert interval for a continuing outage. A logout is not self-healing, so a
 * standing outage should nag — but every 5 minutes would train people to ignore
 * it.
 */
const REALERT_MS = 30 * 60 * 1000;

/**
 * Module-level, so it survives between cron invocations in the long-lived Next
 * server. A restart resets it, at three costs:
 *
 *   - one duplicate alert for an outage that was already being reported;
 *   - if the bridge is already down at restart, `downSince` reseeds to the
 *     restart time, so the recovery alert under-reports total downtime;
 *   - the unreachable window empties, so an ongoing unreachable outage has to
 *     re-earn its second tick — up to one extra tick, 5 minutes, of delay per
 *     restart.
 *
 * The third only exists since the confirmation gate was added and is the reason
 * this comment no longer claims a restart cannot delay an alert: it can. It
 * cannot suppress one indefinitely, because the window refills from the next
 * tick onward. Deploys are the common cause and are not concurrent with outages
 * often enough to justify persisting this to Postgres.
 */
let lastVerdict: BridgeVerdict | null = null;
let lastAlertAt = 0;
/**
 * The PREVIOUS TICK's needsHuman, not the last successfully-alerted one.
 * Keying escalation off the last alert loses a real event: logged_out (alert)
 * -> disconnected (no alert) -> logged_out again would compare true against
 * true, see no escalation, and fold a fresh "a human must act" state into the
 * first outage's 30-minute quiet window.
 */
let prevNeedsHuman = false;
let downSince = 0;
/**
 * Whether each of the last UNREACHABLE_WINDOW_TICKS ticks was `unreachable`,
 * oldest first. Bounded, so it cannot grow across a long-running process.
 */
let unreachableWindow: boolean[] = [];

/** Exported for tests: module state must be resettable between cases. */
export function __resetStateForTests(): void {
  lastVerdict = null;
  lastAlertAt = 0;
  prevNeedsHuman = false;
  downSince = 0;
  unreachableWindow = [];
}

async function probe(): Promise<{ payload: BridgeHealthPayload | null; attempts: number }> {
  const result = await probeBridgeHealth({
    onAttemptFailure: ({ attempt, reason }) => {
      // Logged per attempt, not just on the final verdict: "attempt 1 timed out,
      // attempt 2 succeeded" is the signal that the path is degrading, and it is
      // invisible if only the outcome is recorded.
      log.warn('WA bridge health probe attempt failed', { attempt, reason }, 'WaBridgeHealth');
    },
  });

  if (!result.payload) {
    log.warn('WA bridge health probe exhausted every attempt', {
      attempts: result.attempts,
      lastFailure: result.lastFailure,
    }, 'WaBridgeHealth');
  }

  return { payload: result.payload, attempts: result.attempts };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  // Fail CLOSED, in every environment, matching sync-action-items and
  // recurring-journals. An unauthenticated caller here triggers real email and
  // WhatsApp-group sends, so an unset secret must disable the endpoint rather
  // than open it.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured — rejecting wa-bridge-health request',
      undefined, 'WaBridgeHealth');
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Cron endpoint misconfigured');
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Unauthorized');
  }

  const { payload, attempts: probeAttempts } = await probe();
  const status = classifyBridgeHealth(payload);
  const now = Date.now();

  unreachableWindow = [...unreachableWindow, status.verdict === 'unreachable'].slice(
    -UNREACHABLE_WINDOW_TICKS,
  );
  const unreachableInWindow = unreachableWindow.filter(Boolean).length;

  // A lone `unreachable` tick is observed and counted, but not announced.
  const suppressed =
    status.verdict === 'unreachable' && unreachableInWindow < UNREACHABLE_TICKS_BEFORE_ALERT;

  const observedAlerting = isAlerting(status.verdict);
  const alerting = observedAlerting && !suppressed;
  const wasAlerting = lastVerdict !== null && isAlerting(lastVerdict);

  // Start the clock on the FIRST observation, including a suppressed one, so the
  // recovery all-clear reports the real duration rather than under-reporting it
  // by the length of the gate.
  if (observedAlerting && !downSince) downSince = now;

  if (suppressed) {
    log.warn('WA bridge unreachable — holding the alert pending confirmation', {
      unreachableInWindow,
      windowTicks: UNREACHABLE_WINDOW_TICKS,
      ticksBeforeAlert: UNREACHABLE_TICKS_BEFORE_ALERT,
      probeAttempts,
    }, 'WaBridgeHealth');
  }

  let alerted = false;
  let alertChannels: string[] = [];
  let alertProblems: string[] = [];

  if (alerting) {
    // Fire immediately when the outage starts, and when it escalates to needing
    // a human for the first time. Otherwise respect REALERT_MS — keying off
    // "verdict changed" would let a flap between two alerting verdicts
    // (disconnected <-> logged_out) alert on every 5-minute tick.
    const escalated = status.needsHuman && !prevNeedsHuman;
    if (!wasAlerting || escalated || now - lastAlertAt >= REALERT_MS) {
      const alert = buildBridgeAlert(status);
      if (alert) {
        const { delivered, problems } = await dispatchBridgeAlert(alert.subject, alert.text);
        alertChannels = delivered;
        alertProblems = problems;
        // Only count it as alerted — and only start the 30-minute quiet period —
        // if a channel actually accepted it. Treating a total delivery failure
        // as success would silence the monitor for 30 minutes and recreate the
        // exact "nobody was told" outage this endpoint exists to prevent.
        if (delivered.length > 0) {
          lastAlertAt = now;
          alerted = true;
        }
      }
    }
  } else if (wasAlerting && !suppressed) {
    // Recovered — say so, so whoever got paged is not left checking manually.
    // `!suppressed` matters: logged_out -> unreachable would otherwise fall into
    // this branch and send an all-clear for an outage that is still running.
    const alert = buildBridgeAlert(status, {
      recovered: true,
      downtimeMs: downSince ? now - downSince : undefined,
    });
    if (alert) {
      const { delivered, problems } = await dispatchBridgeAlert(alert.subject, alert.text);
      alertChannels = delivered;
      alertProblems = problems;
      alerted = delivered.length > 0;
    }
    lastAlertAt = 0;
    downSince = 0;
  }

  // A suppressed tick leaves both fields exactly as they were, which is the only
  // option that behaves correctly from every prior state:
  //   healthy     -> suppressed: stays healthy, so no all-clear is invented, and
  //                  the tick that opens the gate still reads as a fresh outage.
  //   logged_out  -> suppressed: stays logged_out, so the running outage is not
  //                  forgotten and the all-clear still fires when it truly ends.
  // Writing an effective verdict instead would break one or the other.
  if (!suppressed) {
    lastVerdict = status.verdict;
    // This is "what we last observed", not "what we last alerted about".
    prevNeedsHuman = status.needsHuman;
  }

  // Cleared here as well as in the recovery branch: a suppressed tick followed
  // by a healthy one takes neither branch, and a stale downSince would inflate
  // the duration reported by the next unrelated outage.
  if (!observedAlerting) downSince = 0;

  if (observedAlerting) {
    log.warn(`WA bridge ${status.verdict}`, {
      phone: status.phone, needsHuman: status.needsHuman, alerted, alertProblems,
      alertSuppressed: suppressed, probeAttempts,
    }, 'WaBridgeHealth');
  }

  // Keyed off what was OBSERVED, not off whether anyone was paged. The status
  // code answers "is the bridge healthy"; the gate governs paging only, and
  // `alerted` / `alertSuppressed` in the body answer that separately. Collapsing
  // the two would log a held tick as http=200, which reads as "all clear" in
  // /tmp/wa-bridge-health.log and hides the run-up to a real outage.
  return res.status(observedAlerting ? 503 : 200).json({
    verdict: status.verdict,
    detail: status.detail,
    phone: status.phone,
    needsHuman: status.needsHuman,
    alerted,
    // Channel names only. `problems` carries raw transport errors that can
    // include SMTP host/port or auth text; those go to the log, not the body.
    alertChannels,
    alertProblemCount: alertProblems.length,
    // Kept in the body because the velo cron appends it verbatim to
    // /tmp/wa-bridge-health.log, which is the only durable record of how this
    // monitor behaved. `probeAttempts: 3` on an otherwise healthy tick is the
    // early warning that the path is degrading.
    probeAttempts,
    unreachableInWindow,
    alertSuppressed: suppressed,
    timestamp: new Date().toISOString(),
  });
}
