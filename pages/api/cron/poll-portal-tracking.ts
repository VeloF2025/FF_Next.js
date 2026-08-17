/**
 * Polls the partner tracking portals and stores new positions.
 *
 * The cron fires every 10 minutes; each provider/account decides whether its
 * own tick is due from fleet_tracking_watermarks.poll_interval_minutes, so the
 * real cadence is data and not this file. Registration is
 * scripts/cron-portal-tracking.sh, which
 * resolves the secret and port from the deploy dir's env file — Vercel crons do
 * not fire for this systemd-hosted app:
 *
 *   0 *\/2 * * * /home/velo/fibreflow-production/scripts/cron-portal-tracking.sh \
 *     >> /home/velo/logs/poll-portal-tracking.log 2>&1
 *
 * Separate from poll-tracking.ts, which polls the Cartrack REST API every 2
 * minutes for the vehicles that support it. These are portal scrapes: slower,
 * heavier, and explicitly hours behind, so they get their own cadence and their
 * own advisory lock.
 *
 * Thin by design: auth, the lock, and the loop. One provider's tick lives in
 * src/services/tracking/pollProvider.ts so it can be tested without a request.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { pool } from '@/lib/db-pool';
import { configuredProviders, pollProvider } from '@/services/tracking/pollProvider';
import { alertRecipientCount } from '@/services/tracking/alerts';
import { runSilenceCheck } from '@/services/tracking/silence';

/** Distinct from poll-tracking's 4417301 so the two never block each other. */
const LOCK_KEY = 4417302;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error('[poll-portal-tracking] CRON_SECRET not configured — rejecting');
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Cron endpoint misconfigured');
  }
  if (req.headers['x-cron-secret'] !== expected) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  // Same pinned-connection discipline as poll-tracking.ts: pg_try_advisory_lock
  // and pg_advisory_unlock are session-scoped, so acquire and release must run
  // on the identical physical connection or the unlock silently no-ops on a
  // session that never held the lock — leaking it forever on whichever
  // session did, since the pool's min:1 floor never evicts it. A distinct
  // LOCK_KEY keeps this cadence's lock independent of poll-tracking's.
  const client = await pool.connect();
  let lockHeld = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    lockHeld = rows[0]?.locked ?? false;
    if (!lockHeld) {
      log.info('[poll-portal-tracking] previous run still in progress — skipping tick');
      return apiResponse.success(res, { skipped: 'already-running' });
    }

    const providers = configuredProviders();
    const results: unknown[] = [];
    for (const entry of providers) {
      // One provider failing must never block the others; pollProvider handles
      // its own errors and returns an error entry rather than throwing.
      results.push(await pollProvider(entry));
    }

    // Once per tick, not inside the loop above: pollProvider runs once PER
    // PROVIDER, but this assesses the whole fleet against check-ins, so a
    // per-provider call would evaluate every vehicle twice on a two-provider
    // tick. A broken silence check must not take the ingestion run down with
    // it — same reasoning as the alert dispatch it feeds.
    let silentTrackers = 0;
    try {
      silentTrackers = (await runSilenceCheck(new Date())).silent;
    } catch (err) {
      log.error('[poll-portal-tracking] silence check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // providersConfigured makes "nothing to do" distinguishable from "nothing
    // happened": a 0 here is the visible half of the log.warn in
    // configuredProviders(). alertRecipients does the same for the alerting
    // path — a 0 means every alert this run raised was dropped on the floor,
    // which is otherwise visible only as a log.warn nobody is watching.
    const alertRecipients = alertRecipientCount();
    if (alertRecipients === 0) {
      log.warn('[poll-portal-tracking] no alert recipients configured — alerts will be dropped', {
        hint: 'set FLEET_ALERT_USER_IDS in the service env file',
      });
    }
    return apiResponse.success(res, {
      providersConfigured: providers.length, alertRecipients, results, silentTrackers,
    });
  } finally {
    let unlockFailed = false;
    if (lockHeld) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      } catch (err) {
        // Must not throw here: the response may already be sent, and an
        // unhandled rejection at this point would surface as exactly that
        // rather than as a clean 5xx.
        unlockFailed = true;
        log.error('[poll-portal-tracking] advisory unlock failed', {
          error: err instanceof Error ? err.message : String(err) });
      }
    }
    // The lock is session-scoped, so a connection whose unlock failed still
    // holds it. Returning that to the pool (min: 1, never evicted) strands
    // the lock for the life of the process and every later tick then skips
    // with a 200 — tracking stops dead while looking healthy. Destroying the
    // connection ends its session, which is what makes Postgres drop the lock.
    client.release(unlockFailed);
  }
}
