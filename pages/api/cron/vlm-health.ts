/**
 * vLLM (VLM) health monitor cron.
 * GET /api/cron/vlm-health
 *
 * On 2026-08-20 09:26 SAST a kernel auto-update left the GPU without a driver
 * bound. `vllm-qwen.service` crash-looped every ~90s for the next 23 hours —
 * 1,705 restart attempts logged in /var/log/vllm-maintenance.log — and nobody
 * was told. The existing self-healing script
 * (`/home/velo/scripts/vllm/health-check.sh`, cron every 5 min on velo) keeps
 * trying to restart the service on every failure but only logs to a file
 * nobody watches. The first anyone heard of it was a field worker's WhatsApp
 * message reporting "Verification Failed: VLM API call failed: fetch failed".
 *
 * This probes the same box's vLLM independently and alerts by email first —
 * see src/lib/vlm-health/alert.ts for why email is primary.
 *
 * Schedule (velo crontab, every 5 minutes):
 *   *\/5 * * * * curl -s http://localhost:3000/api/cron/vlm-health \
 *     -H "x-cron-secret: $CRON_SECRET" >> /home/velo/logs/vlm-health.log 2>&1
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { dispatchVlmAlert } from '@/lib/vlm-health/alert';
import { buildVlmAlert, classifyVlmHealth, isAlerting, type VlmVerdict } from '@/lib/vlm-health/monitor';
import { probeVlmHealth } from '@/lib/vlm-health/probe';

/**
 * Re-alert interval for a continuing outage. A crash loop is not
 * self-resolving on its own account, so a standing outage should nag — but
 * every 5 minutes would train people to ignore it.
 */
const REALERT_MS = 30 * 60 * 1000;

/**
 * Module-level, so it survives between cron invocations in the long-lived
 * Next server. A restart resets it — one duplicate alert for an outage
 * already being reported, and `downSince` reseeds so a recovery alert
 * under-reports total downtime. Deploys are the common cause and are not
 * concurrent with outages often enough to justify persisting this to
 * Postgres — matches src/lib/wa-bridge-health's tradeoff.
 */
let lastVerdict: VlmVerdict | null = null;
let lastAlertAt = 0;
let downSince = 0;

/** Exported for tests: module state must be resettable between cases. */
export function __resetStateForTests(): void {
  lastVerdict = null;
  lastAlertAt = 0;
  downSince = 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  // Fail CLOSED, matching wa-bridge-health / db-health / sync-action-items. An
  // unauthenticated caller here triggers real email and WhatsApp sends, so an
  // unset secret must disable the endpoint rather than open it.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured — rejecting vlm-health request', undefined, 'VlmHealth');
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Cron endpoint misconfigured');
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Unauthorized');
  }

  const probeResult = await probeVlmHealth();
  const status = classifyVlmHealth(probeResult.modelId);
  const now = Date.now();

  // A failure inside the service's own startup grace window is expected
  // during a routine restart (nightly at 03:00, or a manual fix) and must not
  // page. It is still observed and logged, just not escalated.
  const suppressed = status.verdict === 'unreachable' && probeResult.withinStartupGrace;

  const observedAlerting = isAlerting(status.verdict);
  const alerting = observedAlerting && !suppressed;
  const wasAlerting = lastVerdict !== null && isAlerting(lastVerdict);

  if (observedAlerting && !downSince) downSince = now;

  if (suppressed) {
    log.warn('vLLM unreachable — within startup grace, holding the alert', {
      failureReason: probeResult.failureReason,
    }, 'VlmHealth');
  }

  let alerted = false;
  let alertChannels: string[] = [];
  let alertProblems: string[] = [];

  if (alerting) {
    if (!wasAlerting || now - lastAlertAt >= REALERT_MS) {
      const alert = buildVlmAlert(status);
      if (alert) {
        const { delivered, problems } = await dispatchVlmAlert(alert.subject, alert.text);
        alertChannels = delivered;
        alertProblems = problems;
        // Only count it as alerted — and only start the 30-minute quiet
        // period — if a channel actually accepted it. Treating a total
        // delivery failure as success would silence the monitor for 30
        // minutes during a real outage.
        if (delivered.length > 0) {
          lastAlertAt = now;
          alerted = true;
        }
      }
    }
  } else if (wasAlerting && !suppressed) {
    const alert = buildVlmAlert(status, {
      recovered: true,
      downtimeMs: downSince ? now - downSince : undefined,
    });
    if (alert) {
      const { delivered, problems } = await dispatchVlmAlert(alert.subject, alert.text);
      alertChannels = delivered;
      alertProblems = problems;
      alerted = delivered.length > 0;
    }
    lastAlertAt = 0;
    downSince = 0;
  }

  // A suppressed tick leaves lastVerdict exactly as it was: the tick that
  // exits the grace window still reads as a fresh outage rather than a
  // continuation, and a stale `unreachable` is not written over a real
  // `healthy` transition.
  if (!suppressed) lastVerdict = status.verdict;

  if (!observedAlerting) downSince = 0;

  if (observedAlerting) {
    log.warn(`vLLM ${status.verdict}`, {
      modelId: status.modelId,
      failureReason: probeResult.failureReason,
      alerted,
      alertProblems,
      alertSuppressed: suppressed,
    }, 'VlmHealth');
  }

  // Keyed off what was OBSERVED, not off whether anyone was paged — matches
  // wa-bridge-health so a held tick still shows as non-200 in the log rather
  // than reading as "all clear" and hiding the run-up to a real outage.
  return res.status(observedAlerting ? 503 : 200).json({
    verdict: status.verdict,
    detail: status.detail,
    modelId: status.modelId,
    alerted,
    alertChannels,
    alertProblemCount: alertProblems.length,
    alertSuppressed: suppressed,
    timestamp: new Date().toISOString(),
  });
}
