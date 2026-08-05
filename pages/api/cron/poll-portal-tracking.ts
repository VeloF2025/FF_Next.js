/**
 * Polls the partner tracking portals and stores new positions.
 *
 * Runs every 2 hours (crontab on Velocity — Vercel crons do not fire for this
 * systemd-hosted app):
 *
 *   0 *\/2 * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" \
 *     http://localhost:3005/api/cron/poll-portal-tracking \
 *     >> /home/velo/logs/poll-portal-tracking.log 2>&1
 *
 * Separate from poll-tracking.ts, which polls the Cartrack REST API every 2
 * minutes for the vehicles that support it. These are portal scrapes: slower,
 * heavier, and explicitly hours behind, so they get their own cadence and their
 * own advisory lock.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql, pool } from '@/lib/db-pool';
import { netstarProvider } from '@/services/tracking/netstar/provider';
import { netstarClient } from '@/services/tracking/netstar/client';
import { reconcileTrackers } from '@/services/tracking/discovery';
import { ingestPositions } from '@/services/tracking/ingest';
import { raiseTrackingAlert } from '@/services/tracking/alerts';
import type { TrackingProvider } from '@/services/tracking/types';

/** Distinct from poll-tracking's 4417301 so the two never block each other. */
const LOCK_KEY = 4417302;
/** No watermark yet: how far back the first tick reaches. */
const COLD_START_MS = 24 * 60 * 60 * 1000;
/** Re-poll this far behind the watermark; dedup absorbs the overlap. */
const OVERLAP_MS = 60 * 60 * 1000;
/**
 * Hard floor on how far back one tick may reach, regardless of the watermark.
 *
 * The window is not free: the client splits it into 31-day chunks and issues
 * one report job PER VEHICLE PER CHUNK, each polling the export up to ten
 * times. A watermark left stale by a long outage would therefore turn a single
 * tick into hundreds of back-to-back requests against a partner-owned account
 * — which is how an account gets suspended, and the poller is not the tool for
 * that job anyway. `scripts/backfill-tracking.ts` is: it walks the same history
 * deliberately, paced, and is safe to interrupt and resume.
 */
const MAX_POLL_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

interface ConfiguredProvider {
  provider: TrackingProvider;
  listVehicles: () => Promise<Array<{ externalId: string; registration: string | null }>>;
}

function configured(): ConfiguredProvider[] {
  const out: ConfiguredProvider[] = [];
  const { NETSTAR_PORTAL_URL, NETSTAR_PORTAL_USER, NETSTAR_PORTAL_PASS } = process.env;
  if (NETSTAR_PORTAL_URL && NETSTAR_PORTAL_USER && NETSTAR_PORTAL_PASS) {
    const opts = {
      baseUrl: NETSTAR_PORTAL_URL,
      username: NETSTAR_PORTAL_USER,
      password: NETSTAR_PORTAL_PASS,
      accountRef: process.env.NETSTAR_ACCOUNT_REF ?? 'europcar',
    };
    const client = netstarClient(opts);
    out.push({
      provider: netstarProvider({ ...opts, client }),
      listVehicles: () => client.listVehicles(),
    });
  } else {
    // Say so, loudly and by name. A provider that is simply absent from the
    // loop produces a 200 with an empty result set — indistinguishable from a
    // healthy tick — so a typo in a variable name (or an env file that never
    // reached the service) would stay invisible for as long as nobody thought
    // to ask why no positions were arriving.
    const missing = (
      [
        ['NETSTAR_PORTAL_URL', NETSTAR_PORTAL_URL],
        ['NETSTAR_PORTAL_USER', NETSTAR_PORTAL_USER],
        ['NETSTAR_PORTAL_PASS', NETSTAR_PORTAL_PASS],
      ] as const
    ).filter(([, value]) => !value).map(([name]) => name);
    log.warn('[poll-portal-tracking] netstar not configured — skipping provider entirely', {
      missing,
      hint: 'set these in the service env file; until then this cron does nothing',
    });
  }
  return out;
}

function isAuthFailure(message: string): boolean {
  return /login failed|still logged out|HTTP 401\b|HTTP 403\b/i.test(message);
}

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

    const providers = configured();
    const results: unknown[] = [];
    for (const { provider, listVehicles } of providers) {
      // One provider failing must never block the others.
      try {
        const portalVehicles = await listVehicles();
        const recon = await reconcileTrackers(
          provider.key, provider.accountRef, portalVehicles);

        // Independent of this tick's upsert count: reconcileTrackers()
        // short-circuits on an empty portal list (by design — see
        // discovery.ts), so recon.upserted is 0 both on a genuinely fresh
        // account AND on a dying session that never got as far as a real
        // vehicle list. Only the current count of already-mapped trackers
        // can tell those two apart, which is what makes the gap check below
        // fire on a total outage instead of staying silent forever.
        const trackerRows = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM fleet_vehicle_trackers
          WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef} AND is_active
        `;
        const activeTrackers = trackerRows[0]?.n ?? 0;

        const wm = await sql<{ last_event_ts: Date | null; consecutive_failures: number }>`
          SELECT last_event_ts, consecutive_failures FROM fleet_tracking_watermarks
          WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef}
        `;
        const now = new Date();
        const last = wm[0]?.last_event_ts ? new Date(wm[0].last_event_ts) : null;
        const wanted = last
          ? new Date(last.getTime() - OVERLAP_MS)
          : new Date(now.getTime() - COLD_START_MS);
        // Clamped, and the clamp is logged: history older than the floor is
        // NOT fetched by this tick and will not be picked up by a later one
        // either, because the watermark advances past it. Silent truncation
        // here would be a data loss nobody could see.
        const floor = new Date(now.getTime() - MAX_POLL_WINDOW_MS);
        const clamped = wanted.getTime() < floor.getTime();
        const from = clamped ? floor : wanted;
        if (clamped) {
          log.warn('[poll-portal-tracking] poll window clamped — older history skipped', {
            provider: provider.key, accountRef: provider.accountRef,
            requestedFrom: wanted.toISOString(), clampedFrom: from.toISOString(),
            hint: 'run scripts/backfill-tracking.ts to recover the skipped range',
          });
        }

        const positions = await provider.fetchPositions(from, now);
        // The watermark advances from maxIngestedAt — what ingestPositions
        // actually accepted — NEVER from the raw fetched positions. See
        // ingest.ts / poll-tracking.ts for why: a future-dated fix or an
        // all-unmapped batch must not push the window past data that was
        // never stored.
        const { inserted, skippedUnmapped, maxIngestedAt } = await ingestPositions(
          provider.key, provider.accountRef, positions);

        // Authenticating cleanly and returning nothing is the failure mode that
        // otherwise hides for weeks — it looks exactly like a healthy tick.
        // Gated on activeTrackers (mapped NOW), not recon.upserted (mapped BY
        // THIS TICK): a dying session that returns [] from listVehicles never
        // throws and never upserts anything, so recon.upserted alone would
        // stay 0 forever on a total outage while existing mappings (correctly
        // left alone by reconcileTrackers) sit untouched — total silence. An
        // empty portal list against an account known to have vehicles is
        // itself the signal, so it fires even if positions still came back.
        const gap = activeTrackers > 0 && (portalVehicles.length === 0 || positions.length === 0);
        const gapDetail = portalVehicles.length === 0
          ? `portal returned an empty vehicle list while ${activeTrackers} trackers remain mapped`
          : `${activeTrackers} vehicles mapped but the report returned no positions`;

        // Two explicit statements rather than one with a conditional fragment:
        // this repo's SQL tag cannot carry `${cond ? sql`..` : sql``}`.
        //
        // The gap branch INCREMENTS consecutive_failures instead of resetting
        // it, which is what lets decideAlert() suppress a sustained outage
        // after the first notice. The counter still means "consecutive ticks
        // that produced no data", and a genuinely healthy tick below resets it
        // to 0 — so no new column is needed to carry the gap streak.
        let gapTicks = 0;
        if (gap) {
          const bumped = await sql<{ consecutive_failures: number }>`
            INSERT INTO fleet_tracking_watermarks
              (provider, account_ref, last_event_ts, last_run_at, last_error, consecutive_failures)
            VALUES (${provider.key}, ${provider.accountRef}, ${maxIngestedAt ?? last}, now(), ${gapDetail}, 1)
            ON CONFLICT (provider, account_ref) DO UPDATE
              SET last_event_ts = COALESCE(EXCLUDED.last_event_ts, fleet_tracking_watermarks.last_event_ts),
                  last_run_at = now(), last_error = ${gapDetail},
                  consecutive_failures = fleet_tracking_watermarks.consecutive_failures + 1
            RETURNING consecutive_failures
          `;
          gapTicks = bumped[0]?.consecutive_failures ?? 1;
        } else {
          await sql`
            INSERT INTO fleet_tracking_watermarks
              (provider, account_ref, last_event_ts, last_run_at, last_error, consecutive_failures)
            VALUES (${provider.key}, ${provider.accountRef}, ${maxIngestedAt ?? last}, now(), NULL, 0)
            ON CONFLICT (provider, account_ref) DO UPDATE
              SET last_event_ts = COALESCE(EXCLUDED.last_event_ts, fleet_tracking_watermarks.last_event_ts),
                  last_run_at = now(), last_error = NULL, consecutive_failures = 0
          `;
        }

        if (gap) {
          log.warn('[poll-portal-tracking] gap: mapped vehicles but no usable portal data', {
            provider: provider.key, accountRef: provider.accountRef,
            activeTrackers, portalVehicleCount: portalVehicles.length,
            positionCount: positions.length, gapTicks });
          await raiseTrackingAlert({
            kind: 'gap',
            consecutiveFailures: gapTicks,
            nowSast: now,
            provider: provider.key,
            accountRef: provider.accountRef,
            detail: gapDetail,
          });
        }

        log.info('[poll-portal-tracking] polled', {
          provider: provider.key, accountRef: provider.accountRef,
          fetched: positions.length, inserted, skippedUnmapped,
          mapped: recon.upserted, activeTrackers, deactivated: recon.deactivated,
          deactivationSuppressed: recon.deactivationSuppressed,
          fleetOnly: recon.fleetOnly.length, portalOnly: recon.portalOnly.length });

        results.push({
          provider: provider.key, accountRef: provider.accountRef,
          inserted, skippedUnmapped,
          coverage: {
            mapped: recon.upserted,
            activeTrackers,
            notOnPortal: recon.fleetOnly.map((f) => f.registration),
            unknownOnPortal: recon.portalOnly.map((p) => p.externalId),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const auth = isAuthFailure(message);
        // Watermark deliberately untouched — the next tick retries the same
        // window, so a transient outage loses no data. This INSERT omits
        // last_event_ts entirely, so ON CONFLICT never overwrites it.
        const updated = await sql<{ consecutive_failures: number }>`
          INSERT INTO fleet_tracking_watermarks
            (provider, account_ref, last_run_at, last_error, consecutive_failures)
          VALUES (${provider.key}, ${provider.accountRef}, now(), ${message}, 1)
          ON CONFLICT (provider, account_ref) DO UPDATE
            SET last_run_at = now(), last_error = ${message},
                consecutive_failures = fleet_tracking_watermarks.consecutive_failures + 1
          RETURNING consecutive_failures
        `;
        log.error('[poll-portal-tracking] provider failed', {
          provider: provider.key, accountRef: provider.accountRef,
          error: message, authFailure: auth });
        await raiseTrackingAlert({
          kind: auth ? 'auth' : 'transient',
          consecutiveFailures: updated[0]?.consecutive_failures ?? 1,
          nowSast: new Date(),
          provider: provider.key,
          accountRef: provider.accountRef,
          detail: message,
        });
        results.push({
          provider: provider.key, accountRef: provider.accountRef,
          error: message, authFailure: auth });
      }
    }
    // providersConfigured makes "nothing to do" distinguishable from "nothing
    // happened": a 0 here is the visible half of the log.warn in configured().
    return apiResponse.success(res, { providersConfigured: providers.length, results });
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
