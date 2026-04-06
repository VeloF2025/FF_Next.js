/**
 * Database Health Monitor Cron
 * GET /api/cron/db-health
 *
 * Active health probe that runs on a schedule (every 60s via external cron).
 * - Pings Neon DB with SELECT 1
 * - Measures latency
 * - Reports circuit breaker state
 * - Sends WhatsApp alert if DB is unhealthy or degraded
 *
 * Schedule: * * * * * (every minute)
 * Curl:     curl -s https://dev.fibreflow.app/api/cron/db-health
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { pool, getDbCircuitStats, resetDbCircuit } from '@/lib/db';
import { log } from '@/lib/logger';

const WA_FEEDBACK_URL = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';
const WA_GROUP_JID = process.env.WA_INFRA_GROUP_JID || '120363421664266245@g.us';
const DEGRADED_THRESHOLD_MS = 5000;
const CRON_SECRET = process.env.CRON_SECRET;

// In-memory alert cooldown (don't spam WA)
let lastAlertAt = 0;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

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

  const response = {
    status,
    timestamp: new Date().toISOString(),
    latencyMs,
    error: errorMessage,
    circuit: circuitStats,
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
    await fetch(`${WA_FEEDBACK_URL}/send-message`, {
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
