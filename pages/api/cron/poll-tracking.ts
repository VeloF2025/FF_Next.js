/**
 * Polls every configured tracking provider and stores new positions.
 *
 * Cron (Velocity crontab — Vercel crons do not fire for this systemd-hosted app):
 *   *\/2 * * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" \
 *     http://localhost:3005/api/cron/poll-tracking >> /home/velo/logs/poll-tracking.log 2>&1
 *
 * Devices report every 1-4 min; polling faster than they transmit gains
 * nothing. Cartrack returns all vehicles in one call, so cost is one
 * request per tick regardless of fleet size.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql, pool } from '@/lib/db-pool';
import { cartrackProvider } from '@/services/tracking/cartrack/provider';
import { ingestPositions } from '@/services/tracking/ingest';
import { resolveWindow } from '@/services/tracking/windowBudget';
import type { ProviderKey, TrackingProvider } from '@/services/tracking/types';

/** Advisory lock key so a slow run is not re-entered by the next tick. */
const LOCK_KEY = 4417301;

type PollResult =
  | {
      provider: ProviderKey;
      accountRef: string;
      inserted: number;
      skippedUnmapped: number;
      windowFrom: string;
      windowTo: string;
      /**
       * Minutes of history the event budget forced this tick to skip, present
       * only when that happened. It rides in the response because the cron
       * appends this body to /home/velo/logs/poll-tracking.log — log.warn goes
       * to journald, which is not where anyone looks when a day of telemetry is
       * missing. A clamp is not an error, so it must not raise
       * consecutive_failures; but it must not be invisible either.
       */
      clampedMinutes?: number;
    }
  | { provider: ProviderKey; accountRef: string; error: string; authFailure: boolean };

function configuredProviders(): TrackingProvider[] {
  const out: TrackingProvider[] = [];
  const { CARTRACK_BASE_URL, CARTRACK_API_USER, CARTRACK_API_PASS } = process.env;
  if (CARTRACK_BASE_URL && CARTRACK_API_USER && CARTRACK_API_PASS) {
    out.push(cartrackProvider({
      baseUrl: CARTRACK_BASE_URL,
      username: CARTRACK_API_USER,
      password: CARTRACK_API_PASS,
      accountRef: process.env.CARTRACK_ACCOUNT_REF ?? 'default',
    }));
  }
  return out;
}

/**
 * A 401 means credentials or entitlement — not a transient blip — and
 * retrying on the next tick will never fix it (live reality: Urent's
 * Cartrack account returns 401 today because its API entitlement isn't
 * switched on). It must read differently in the logs than a 500 so nobody
 * waits for it to self-heal.
 */
function isAuthFailure(message: string): boolean {
  return /HTTP 401\b/.test(message);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }

  // Mirrors pages/api/cron/fleet-check-reminders.ts — the canonical
  // cron-auth pattern in this repo: fail closed when the secret is unset.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error('[poll-tracking] CRON_SECRET not configured — rejecting');
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Cron endpoint misconfigured');
  }
  if (req.headers['x-cron-secret'] !== expected) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  // pg_try_advisory_lock/pg_advisory_unlock are SESSION-scoped: the acquire
  // and release must run on the same physical connection or the unlock
  // silently no-ops (a WARNING, not a thrown error) on a session that never
  // held the lock — leaking the lock on whichever session did acquire it
  // forever, since the pool's `min: 1` floor (src/lib/db.ts) never evicts
  // it. `sql`/pool.query() each check out an arbitrary connection, so they
  // cannot be used here. A pinned client guarantees same-session acquire and
  // release. It also preserves the crash-safety we rely on: if this process
  // dies mid-run, the dropped TCP connection releases the lock for free —
  // no cleanup step required. (Deliberately not transaction() +
  // pg_try_advisory_xact_lock: that would wrap the multi-second poll in a
  // transaction, contradicting the "chunks are NOT wrapped in a
  // transaction" decision in ingest.ts.)
  const client = await pool.connect();
  let lockHeld = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    lockHeld = rows[0]?.locked ?? false;
    if (!lockHeld) {
      log.info('[poll-tracking] previous run still in progress — skipping tick');
      return apiResponse.success(res, { skipped: 'already-running' });
    }

    const results: PollResult[] = [];
    for (const provider of configuredProviders()) {
      // One provider failing must never block the others.
      try {
        const wm = await sql<{ last_event_ts: Date | null }>`
          SELECT last_event_ts FROM fleet_tracking_watermarks
          WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef}
        `;
        const now = new Date();
        const last = wm[0]?.last_event_ts ? new Date(wm[0].last_event_ts) : null;

        // The window has to fit what this provider will actually serve. The
        // feed is account-wide, so its event count scales with the active
        // fleet: a 6h cold start costs ~8k events at 7 vehicles but ~26k at
        // 22, past the 20k budget. Unclamped, that throws — and since a throw
        // leaves the watermark unset, the next tick cold-starts and throws
        // again. The poller would never start at all, and the logs would show
        // only a pagination error with no hint that fleet size caused it.
        const trackerRows = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM fleet_vehicle_trackers
          WHERE provider = ${provider.key}
            AND account_ref = ${provider.accountRef}
            AND is_active
        `;
        const activeTrackers = trackerRows[0]?.n ?? 0;
        const { from, clampedMs, maxWindowMs: maxWindow } = resolveWindow({
          last, now, maxEventsPerFetch: provider.maxEventsPerFetch, activeTrackers,
        });

        if (clampedMs > 0) {
          // Never let this be silent: the window was narrowed, so some history
          // is not fetched on this tick and — past the provider's retention —
          // never will be. Also reported in the response below, since that is
          // what reaches the cron's log file.
          log.warn('[poll-tracking] window clamped to the provider event budget', {
            provider: provider.key,
            accountRef: provider.accountRef,
            activeTrackers,
            skippedMinutes: Math.round(clampedMs / 60_000),
            maxWindowMinutes: Math.round(maxWindow / 60_000),
            clampedFrom: from.toISOString(),
          });
        }

        const positions = await provider.fetchPositions(from, now);
        // accountRef is threaded through (not just provider.key) because
        // migration 441 keys tracker uniqueness — and the ingest lookup —
        // on (provider, account_ref, external_id). Urent is a second
        // Cartrack account being onboarded alongside Velocity's; dropping
        // accountRef here would let a shared external_id silently
        // attribute positions to the wrong vehicle.
        const { inserted, skippedUnmapped, maxIngestedAt } = await ingestPositions(
          provider.key, provider.accountRef, positions);

        // The watermark advances from maxIngestedAt — the max recordedAt
        // among positions ingestPositions actually accepted as insert
        // candidates — NEVER from the raw fetched positions. That is what
        // makes the watermark reflect only stored (or storable) data:
        //   - A future-dated fix (device clock skew) is rejected inside
        //     ingestPositions before it can touch maxIngestedAt, so it can
        //     never push the window past real data and strand polling on
        //     an inverted from/to window forever.
        //   - An all-unmapped batch (e.g. migration 441 applied but
        //     trackers not mapped yet) yields maxIngestedAt = null here, so
        //     `maxIngestedAt ?? last` reinserts the existing watermark
        //     unchanged — the cold-start backfill window survives until
        //     mapping lands, instead of being burned early.
        await sql`
          INSERT INTO fleet_tracking_watermarks (provider, account_ref, last_event_ts, last_run_at, last_error, consecutive_failures)
          VALUES (${provider.key}, ${provider.accountRef}, ${maxIngestedAt ?? last}, now(), NULL, 0)
          ON CONFLICT (provider, account_ref) DO UPDATE
            SET last_event_ts = COALESCE(EXCLUDED.last_event_ts, fleet_tracking_watermarks.last_event_ts),
                last_run_at = now(), last_error = NULL, consecutive_failures = 0
        `;

        log.info('[poll-tracking] polled', {
          provider: provider.key, accountRef: provider.accountRef,
          fetched: positions.length, inserted, skippedUnmapped });
        results.push({
          provider: provider.key, accountRef: provider.accountRef,
          inserted, skippedUnmapped,
          windowFrom: from.toISOString(), windowTo: now.toISOString(),
          // Omitted entirely on a normal tick, so its presence in the cron log
          // is the signal — no scanning past a "clampedMinutes: 0" on every line.
          ...(clampedMs > 0 ? { clampedMinutes: Math.round(clampedMs / 60_000) } : {}) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const authFailure = isAuthFailure(message);
        // Watermark deliberately untouched — the next tick retries the same
        // window, so a transient outage loses no data. Note this INSERT
        // omits last_event_ts entirely, so ON CONFLICT never overwrites it.
        await sql`
          INSERT INTO fleet_tracking_watermarks (provider, account_ref, last_run_at, last_error, consecutive_failures)
          VALUES (${provider.key}, ${provider.accountRef}, now(), ${message}, 1)
          ON CONFLICT (provider, account_ref) DO UPDATE
            SET last_run_at = now(), last_error = ${message},
                consecutive_failures = fleet_tracking_watermarks.consecutive_failures + 1
        `;
        if (authFailure) {
          log.error('[poll-tracking] provider auth failure — credentials/entitlement, will not self-heal', {
            provider: provider.key, accountRef: provider.accountRef, error: message });
        } else {
          log.error('[poll-tracking] provider failed', {
            provider: provider.key, accountRef: provider.accountRef, error: message });
        }
        results.push({
          provider: provider.key, accountRef: provider.accountRef, error: message, authFailure });
      }
    }
    return apiResponse.success(res, { results });
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
        log.error('[poll-tracking] advisory unlock failed', {
          error: err instanceof Error ? err.message : String(err) });
      }
    }
    // The lock is session-scoped, so a connection whose unlock failed still
    // holds it. Returning that to the pool (min: 1, so it is never evicted)
    // strands the lock for the life of the process and every later tick then
    // skips with a 200 — tracking stops dead and looks healthy. Destroying the
    // connection ends its session, which is what makes Postgres drop the lock.
    client.release(unlockFailed);
  }
}
