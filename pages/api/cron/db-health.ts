/**
 * Database Health Monitor Cron
 * GET /api/cron/db-health
 *
 * Active health probe that runs on a schedule (every 60s via external cron).
 * - Pings Neon DB with SELECT 1
 * - Measures latency
 * - Reports circuit breaker state
 * - Sends WhatsApp alert if DB is unhealthy or degraded
 * - Piggybacks a liveness check on the nightly project-AOI refresh
 *
 * The AOI check is a passenger here for one structural reason: a monitor that
 * runs inside the job it watches cannot report that job's absence. This
 * endpoint runs every minute from its own crontab line, its own script and its
 * own process, so it can. It is STRICTLY best-effort — see
 * `checkProjectAoiLiveness` below — and can never change the database verdict,
 * the HTTP status, or the exit path.
 *
 * Schedule: * * * * * (every minute)
 * Curl:     curl -s https://dev.fibreflow.app/api/cron/db-health
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { pool, getDbCircuitStats, resetDbCircuit } from '@/lib/db';
import { log } from '@/lib/logger';
import {
  buildStalenessMessage,
  claimFreshnessAlert,
  type AoiFreshness,
} from '@/modules/attendance/alerts/projectAoiStaleness';
import { probeAoiFreshness } from '@/modules/attendance/alerts/projectAoiStalenessProbe';
import { sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';

// Infra alerts go to a WhatsApp GROUP via the message bridge's /send-message.
// NOT the wa-feedback service (:8092) — that only exposes /send-feedback, so
// /send-message there 404s and the alert is silently dropped. Use the message
// bridge (:8083), same as the canonical sender (communications/whatsapp).
const WA_BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'http://72.61.197.178:8083';
const WA_GROUP_JID = process.env.WA_INFRA_GROUP_JID || '120363421664266245@g.us';
const DEGRADED_THRESHOLD_MS = 5000;
const CRON_SECRET = process.env.CRON_SECRET;

// In-memory alert cooldown (don't spam WA)
let lastAlertAt = 0;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// The AOI alert goes where the AOI refresh's own alerts go — Hein's DM by
// configuration — not to the infra group. Different audience, different
// decision: this one needs a person to look at pole data, not at a database.
// The bridge routes by JID, so a DM JID and a group JID are the same call.
const AOI_ALERT_JID =
  process.env.ATTENDANCE_OPS_WA_GROUP_JID || process.env.WA_INFRA_GROUP_JID || WA_GROUP_JID;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional: verify cron secret to prevent abuse
  if (CRON_SECRET && req.headers['x-cron-secret'] !== CRON_SECRET) {
    // Allow without secret in dev, but log it
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const circuitStats = getDbCircuitStats();

  // Allow manual reset via ?reset=true
  if (req.query.reset === 'true') {
    resetDbCircuit();
    log.info('[db-health] Circuit breaker manually reset via API');
    return res.status(200).json({
      status: 'reset',
      message: 'Circuit breaker reset',
      circuit: getDbCircuitStats(),
    });
  }

  // Probe the database
  const start = Date.now();
  let dbHealthy = false;
  let latencyMs = 0;
  let errorMessage: string | null = null;

  try {
    await pool.query('SELECT 1 AS check');
    latencyMs = Date.now() - start;
    dbHealthy = true;
  } catch (error) {
    latencyMs = Date.now() - start;
    errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[db-health] Probe failed:', { error: errorMessage, latencyMs });
  }

  const isDegraded = dbHealthy && latencyMs > DEGRADED_THRESHOLD_MS;
  const isCircuitOpen = circuitStats.state === 'OPEN';

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (!dbHealthy || isCircuitOpen) {
    status = 'unhealthy';
  } else if (isDegraded) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  // Alert on unhealthy or degraded
  if (status !== 'healthy') {
    await maybeSendAlert(status, latencyMs, errorMessage, circuitStats);
  }

  // Skipped when the database itself is down: the AOI probe would only fail the
  // same way, and "the nightly refresh looks dead" is a misleading thing to say
  // during a database outage.
  const projectAoi = dbHealthy ? await checkProjectAoiLiveness() : null;

  const response = {
    status,
    timestamp: new Date().toISOString(),
    latencyMs,
    error: errorMessage,
    circuit: circuitStats,
    projectAoi,
    pool: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    },
  };

  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 207 : 503;
  return res.status(httpStatus).json(response);
}

async function maybeSendAlert(
  status: string,
  latencyMs: number,
  error: string | null,
  circuit: ReturnType<typeof getDbCircuitStats>
): Promise<void> {
  const now = Date.now();
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) {
    return; // Still in cooldown
  }

  lastAlertAt = now;

  const emoji = status === 'unhealthy' ? '🚨' : '⚠️';
  const message = [
    `${emoji} *DB HEALTH: ${status.toUpperCase()}*`,
    '',
    `*Latency:* ${latencyMs}ms`,
    error ? `*Error:* ${error}` : null,
    `*Circuit:* ${circuit.state}`,
    circuit.consecutiveFailures > 0 ? `*Consecutive failures:* ${circuit.consecutiveFailures}` : null,
    circuit.totalTrips > 0 ? `*Total trips:* ${circuit.totalTrips}` : null,
    '',
    '_Auto-detected by /api/cron/db-health_',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await fetch(`${WA_BRIDGE_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_jid: WA_GROUP_JID, message }),
      signal: AbortSignal.timeout(5000),
    });
    log.info(`[db-health] Alert sent: ${status}`);
  } catch (err) {
    log.warn('[db-health] Failed to send WA alert');
  }
}

/**
 * Liveness check for the nightly project-AOI refresh. STRICTLY best-effort.
 *
 * Everything is inside one try/catch that returns null rather than rethrowing.
 * This function is a passenger on a per-minute production database probe: if
 * an attendance data-quality check throws — a missing table, a renamed column,
 * a WhatsApp bridge timeout — db-health must still report database health and
 * still return normally. Its failure must never page anyone about the database,
 * and must never change the HTTP status this endpoint returns.
 *
 * The returned object is also the queryable surface: `curl` the endpoint and
 * the AOI state is right there next to the database state.
 */
async function checkProjectAoiLiveness(): Promise<AoiFreshness | null> {
  try {
    const now = Date.now();
    const freshness = await probeAoiFreshness(
      async <R>(text: string) => (await pool.query(text)).rows as R[],
      now,
    );

    if (claimFreshnessAlert(freshness, now)) {
      try {
        await sendWhatsAppGroup(AOI_ALERT_JID, buildStalenessMessage(freshness));
        log.warn('[db-health] project AOI refresh alert sent', {
          state: freshness.state, detail: freshness.detail,
        });
      } catch (sendErr) {
        // The cooldown has already been claimed, so a failed send costs the
        // next 24h of alerts for this state. That is the deliberate trade: the
        // alternative is releasing the claim and retrying every 60 seconds
        // through a bridge outage, which is a 1,440-message backlog aimed at
        // one person's DM.
        log.warn('[db-health] project AOI alert send failed', {
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
      }
    }

    return freshness;
  } catch (err) {
    log.warn('[db-health] project AOI liveness check failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
