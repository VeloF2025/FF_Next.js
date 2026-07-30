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
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Re-alert interval for an unchanged verdict. A logout is not self-healing, so
 * a standing outage should nag — but every 5 minutes would train people to
 * ignore it.
 */
const REALERT_MS = 30 * 60 * 1000;

/**
 * Module-level, so it survives between cron invocations in the long-lived Next
 * server. A restart resets it, which only costs one duplicate alert.
 */
let lastVerdict: BridgeVerdict | null = null;
let lastAlertAt = 0;
let downSince = 0;

async function probe(): Promise<BridgeHealthPayload | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(BRIDGE_HEALTH_URL, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as BridgeHealthPayload;
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
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (CRON_SECRET && req.headers['x-cron-secret'] !== CRON_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const status = classifyBridgeHealth(await probe());
  const now = Date.now();
  const alerting = isAlerting(status.verdict);
  const changed = status.verdict !== lastVerdict;

  let alerted = false;

  if (alerting) {
    if (!downSince) downSince = now;
    // Alert on a state change immediately, otherwise only once per REALERT_MS.
    if (changed || now - lastAlertAt >= REALERT_MS) {
      const alert = buildBridgeAlert(status);
      if (alert) {
        await dispatchBridgeAlert(alert.subject, alert.text);
        lastAlertAt = now;
        alerted = true;
      }
    }
  } else if (lastVerdict && isAlerting(lastVerdict)) {
    // Recovered — say so, so whoever got paged is not left checking manually.
    const alert = buildBridgeAlert(status, {
      recovered: true,
      downtimeMs: downSince ? now - downSince : undefined,
    });
    if (alert) {
      await dispatchBridgeAlert(alert.subject, alert.text);
      alerted = true;
    }
    lastAlertAt = 0;
    downSince = 0;
  }

  lastVerdict = status.verdict;

  if (alerting) {
    log.warn(`WA bridge ${status.verdict}`, {
      phone: status.phone, needsHuman: status.needsHuman, alerted,
    }, 'WaBridgeHealth');
  }

  return res.status(alerting ? 503 : 200).json({
    verdict: status.verdict,
    detail: status.detail,
    phone: status.phone,
    needsHuman: status.needsHuman,
    alerted,
    timestamp: new Date().toISOString(),
  });
}
