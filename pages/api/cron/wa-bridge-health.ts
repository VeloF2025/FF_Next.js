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
 *   star/5 * * * * curl -sf http://localhost:3000/api/cron/wa-bridge-health \
 *     -H "x-cron-secret: $CRON_SECRET" >> /tmp/wa-bridge-health.log 2>&1
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

const BRIDGE_HEALTH_URL =
  process.env.WA_BRIDGE_HEALTH_URL ?? 'http://72.61.197.178:8083/health';
const PROBE_TIMEOUT_MS = 8000;

/**
 * Re-alert interval for a continuing outage. A logout is not self-healing, so a
 * standing outage should nag — but every 5 minutes would train people to ignore
 * it.
 */
const REALERT_MS = 30 * 60 * 1000;

/**
 * Module-level, so it survives between cron invocations in the long-lived Next
 * server. A restart resets it, which costs one duplicate alert and — if the
 * bridge is already down at restart — reseeds `downSince` to the restart time,
 * so the recovery alert then under-reports total downtime. Both are acceptable;
 * neither can suppress an alert.
 */
let lastVerdict: BridgeVerdict | null = null;
let lastAlertAt = 0;
let lastAlertNeedsHuman = false;
let downSince = 0;

/** Exported for tests: module state must be resettable between cases. */
export function __resetStateForTests(): void {
  lastVerdict = null;
  lastAlertAt = 0;
  lastAlertNeedsHuman = false;
  downSince = 0;
}

async function probe(): Promise<BridgeHealthPayload | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(BRIDGE_HEALTH_URL, { signal: controller.signal });
    if (!res.ok) {
      // A 500/502 from the bridge collapses into the same `unreachable` verdict
      // as a dead VPS, so without this line the two are indistinguishable when
      // someone comes to diagnose.
      log.warn('WA bridge health endpoint returned non-OK', {
        url: BRIDGE_HEALTH_URL, status: res.status,
      }, 'WaBridgeHealth');
      return null;
    }
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      log.warn('WA bridge health returned an unexpected payload shape', {
        url: BRIDGE_HEALTH_URL, received: typeof body,
      }, 'WaBridgeHealth');
      return null;
    }
    return body as BridgeHealthPayload;
  } catch (err) {
    // Unreachable is a verdict, not an error — the caller classifies null. Log
    // the reason anyway: "timed out" vs "connection refused" vs DNS failure is
    // the difference between a dead VPS, a stopped service and a routing
    // problem, and it is the first thing anyone will want when diagnosing.
    log.warn('WA bridge health probe failed', {
      url: BRIDGE_HEALTH_URL,
      error: err instanceof Error ? err.message : String(err),
    }, 'WaBridgeHealth');
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  const status = classifyBridgeHealth(await probe());
  const now = Date.now();
  const alerting = isAlerting(status.verdict);
  const wasAlerting = lastVerdict !== null && isAlerting(lastVerdict);

  let alerted = false;
  let alertProblems: string[] = [];

  if (alerting) {
    if (!downSince) downSince = now;

    // Fire immediately when the outage starts, and when it escalates to needing
    // a human for the first time. Otherwise respect REALERT_MS — keying off
    // "verdict changed" would let a flap between two alerting verdicts
    // (disconnected <-> logged_out) alert on every 5-minute tick.
    const escalated = status.needsHuman && !lastAlertNeedsHuman;
    if (!wasAlerting || escalated || now - lastAlertAt >= REALERT_MS) {
      const alert = buildBridgeAlert(status);
      if (alert) {
        const { delivered, problems } = await dispatchBridgeAlert(alert.subject, alert.text);
        alertProblems = problems;
        // Only count it as alerted — and only start the 30-minute quiet period —
        // if a channel actually accepted it. Treating a total delivery failure
        // as success would silence the monitor for 30 minutes and recreate the
        // exact "nobody was told" outage this endpoint exists to prevent.
        if (delivered.length > 0) {
          lastAlertAt = now;
          lastAlertNeedsHuman = status.needsHuman;
          alerted = true;
        }
      }
    }
  } else if (wasAlerting) {
    // Recovered — say so, so whoever got paged is not left checking manually.
    const alert = buildBridgeAlert(status, {
      recovered: true,
      downtimeMs: downSince ? now - downSince : undefined,
    });
    if (alert) {
      const { delivered, problems } = await dispatchBridgeAlert(alert.subject, alert.text);
      alertProblems = problems;
      alerted = delivered.length > 0;
    }
    lastAlertAt = 0;
    lastAlertNeedsHuman = false;
    downSince = 0;
  }

  lastVerdict = status.verdict;

  if (alerting) {
    log.warn(`WA bridge ${status.verdict}`, {
      phone: status.phone, needsHuman: status.needsHuman, alerted, alertProblems,
    }, 'WaBridgeHealth');
  }

  return res.status(alerting ? 503 : 200).json({
    verdict: status.verdict,
    detail: status.detail,
    phone: status.phone,
    needsHuman: status.needsHuman,
    alerted,
    alertProblems,
    timestamp: new Date().toISOString(),
  });
}
