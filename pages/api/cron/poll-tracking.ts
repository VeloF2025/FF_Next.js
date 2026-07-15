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
import type { ProviderKey, TrackingProvider } from '@/services/tracking/types';

/**
 * Re-poll this far back before the watermark; dedup absorbs the overlap.
 *
 * Sized for buffering, not for clock skew. The watermark is one scalar per
 * account (max event_ts), but a vehicle that loses GSM coverage keeps
 * recording and uploads those fixes late, stamped with the event time they
 * happened at. Meanwhile the other vehicles hold the watermark near now — so
 * anything older than this overlap when it lands is never fetched again, and
 * Cartrack's 24h cap makes it unrecoverable the next day. 30 minutes covers
 * an ordinary dropout (parking basement, rural stretch); a longer outage
 * still loses fixes, which a per-tracker watermark would fix properly (#2169).
 *
 * Cheap to widen: ingest dedups on ON CONFLICT DO NOTHING, so replaying a
 * window costs bandwidth, not correctness — but only up to the provider's
 * event budget, which is what clampWindowStart below enforces.
 */
const OVERLAP_MS = 30 * 60 * 1000;
/** First run with no watermark: how far back to backfill, budget permitting. */
const COLD_START_MS = 6 * 60 * 60 * 1000;

/**
 * Assumed events per hour per tracked vehicle, for sizing the query window.
 *
 * Measured against the live Velocity account on 2026-07-15: ~200/hour/vehicle,
 * consistent across 10min/30min/1h/6h probes. 300 carries ~50% headroom, since
 * guessing high costs a narrower window while guessing low throws.
 */
const EVENTS_PER_HOUR_PER_VEHICLE = 300;

/**
 * Fraction of the provider's event budget a single window may plan to use.
 * The rate above is an average; leaving room means a burst of hard-braking
 * events doesn't tip an otherwise-legal window over the edge.
 */
const BUDGET_UTILISATION = 0.8;

/**
 * Never plan a window narrower than this. Below it the fleet has outgrown a
 * single account-wide poll and no window keeps up — losing data either way, so
 * fail visibly rather than silently shrinking to nothing.
 */
const MIN_WINDOW_MS = 5 * 60 * 1000;
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
    }
  | { provider: ProviderKey; accountRef: string; error: string; authFailure: boolean };

/**
 * Widest window this provider can be asked for without blowing its event
 * budget, given how many vehicles are currently feeding it.
 *
 * These feeds are account-wide: events scale with the number of active
 * trackers, so the safe window shrinks as the fleet grows. Exported for tests.
 */
export function maxWindowMsFor(maxEventsPerFetch: number, activeTrackers: number): number {
  // No trackers means no events to page through, so nothing to clamp against.
  if (activeTrackers <= 0) return COLD_START_MS;
  const hours =
    (maxEventsPerFetch * BUDGET_UTILISATION) / (EVENTS_PER_HOUR_PER_VEHICLE * activeTrackers);
  return Math.max(hours * 60 * 60 * 1000, MIN_WINDOW_MS);
}

/**
 * Pull `from` forward if the window it implies is wider than the budget allows.
 *
 * Returns the clamped start plus what was given up, so the caller can say so
 * out loud. Losing history here is a real cost — it is only ever the better of
 * two bad options, because the unclamped alternative throws and ingests
 * nothing at all, forever.
 */
export function clampWindowStart(
  desiredFrom: Date,
  now: Date,
  maxWindowMs: number
): { from: Date; clampedMs: number } {
  const floor = new Date(now.getTime() - maxWindowMs);
  if (desiredFrom.getTime() >= floor.getTime()) return { from: desiredFrom, clampedMs: 0 };
  return { from: floor, clampedMs: floor.getTime() - desiredFrom.getTime() };
}

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
        const desiredFrom = last
          ? new Date(last.getTime() - OVERLAP_MS)
          : new Date(now.getTime() - COLD_START_MS);

        // How wide a window this account can afford right now. The feed is
        // account-wide, so its event count scales with the active fleet: a
        // 6h cold start costs ~8k events at 7 vehicles but ~26k at 22, past
        // the 20k budget. Unclamped, that throws — and since a throw leaves
        // the watermark unset, the next tick cold-starts and throws again.
        // The poller would never start at all, and the logs would show only
        // a pagination error with no hint that the fleet size caused it.
        const trackerRows = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM fleet_vehicle_trackers
          WHERE provider = ${provider.key}
            AND account_ref = ${provider.accountRef}
            AND is_active
        `;
        const activeTrackers = trackerRows[0]?.n ?? 0;
        const maxWindow = maxWindowMsFor(provider.maxEventsPerFetch, activeTrackers);
        const { from, clampedMs } = clampWindowStart(desiredFrom, now, maxWindow);

        if (clampedMs > 0) {
          // Never let this be silent: the window was narrowed, so some history
          // will not be fetched on this tick and — past the provider's
          // retention — may never be.
          log.warn('[poll-tracking] window clamped to the provider event budget', {
            provider: provider.key,
            accountRef: provider.accountRef,
            activeTrackers,
            skippedMinutes: Math.round(clampedMs / 60_000),
            maxWindowMinutes: Math.round(maxWindow / 60_000),
            requestedFrom: desiredFrom.toISOString(),
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
          windowFrom: from.toISOString(), windowTo: now.toISOString() });
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
