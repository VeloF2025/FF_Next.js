/**
 * One provider's tick: reconcile, fetch, ingest, move the watermark, alert.
 *
 * Extracted from pages/api/cron/poll-portal-tracking.ts so the route is only
 * auth, the advisory lock, and the loop — and so this logic can be exercised
 * without a request. Everything here is per provider and self-contained: a
 * provider that fails returns an error entry rather than throwing, because one
 * provider must never take the others down with it.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { netstarProvider } from '@/services/tracking/netstar/provider';
import { netstarClient, PartialFetchError } from '@/services/tracking/netstar/client';
import { reconcileTrackers } from '@/services/tracking/discovery';
import { ingestPositions } from '@/services/tracking/ingest';
import { raiseTrackingAlert } from '@/services/tracking/alerts';
import type { PortalVehicle } from '@/services/tracking/portal/registration';
import type { ProviderPosition, TrackingProvider } from '@/services/tracking/types';

/** No watermark yet: how far back the first tick reaches. */
const COLD_START_MS = 24 * 60 * 60 * 1000;
/** Re-poll this far behind the watermark; dedup absorbs the overlap. */
const OVERLAP_MS = 60 * 60 * 1000;
/**
 * Hard floor on how far back one tick may reach, regardless of the watermark.
 * The client issues one report job PER VEHICLE PER CHUNK, so a watermark left
 * stale by a long outage would turn one tick into hundreds of back-to-back
 * requests against a partner-owned account. Recovering history is
 * scripts/backfill-tracking.ts's job, deliberately and paced.
 */
const MAX_POLL_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

export interface ConfiguredProvider {
  provider: TrackingProvider;
  listVehicles: () => Promise<PortalVehicle[]>;
}

export function configuredProviders(): ConfiguredProvider[] {
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

export function isAuthFailure(message: string): boolean {
  return /login failed|still logged out|HTTP 401\b|HTTP 403\b/i.test(message);
}

/**
 * Fetch, tolerating a partial result.
 *
 * A PartialFetchError means some vehicles were fetched and some were not. The
 * positions that arrived are still worth storing, but the window was not fully
 * covered — so the caller must NOT advance the watermark past it, or the
 * vehicles that failed lose that window permanently. `complete: false` is what
 * carries that.
 */
async function fetchTolerantly(
  provider: TrackingProvider, from: Date, to: Date
): Promise<{ positions: ProviderPosition[]; complete: boolean; detail: string | null }> {
  try {
    return { positions: await provider.fetchPositions(from, to), complete: true, detail: null };
  } catch (err) {
    if (err instanceof PartialFetchError) {
      log.warn('[poll-portal-tracking] partial fetch — storing what arrived, holding the watermark', {
        provider: provider.key, accountRef: provider.accountRef,
        recovered: err.positions.length, failures: err.failures,
      });
      return { positions: err.positions, complete: false, detail: err.message };
    }
    throw err;
  }
}

export async function pollProvider(
  { provider, listVehicles }: ConfiguredProvider
): Promise<Record<string, unknown>> {
  try {
    const portalVehicles = await listVehicles();
    const recon = await reconcileTrackers(provider.key, provider.accountRef, portalVehicles);

    // Independent of this tick's upsert count: reconcileTrackers()
    // short-circuits on an empty portal list (by design — see discovery.ts),
    // so recon.upserted is 0 both on a genuinely fresh account AND on a dying
    // session that never got as far as a real vehicle list. Only the current
    // count of already-mapped trackers can tell those two apart.
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
    // Clamped, and the clamp is logged: history older than the floor is NOT
    // fetched by this tick and will not be picked up by a later one either,
    // because the watermark advances past it. Silent truncation here would be
    // a data loss nobody could see.
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

    const fetched = await fetchTolerantly(provider, from, now);
    const positions = fetched.positions;
    // The watermark advances from maxIngestedAt — what ingestPositions actually
    // accepted — NEVER from the raw fetched positions. See ingest.ts /
    // poll-tracking.ts for why: a future-dated fix or an all-unmapped batch must
    // not push the window past data that was never stored.
    const { inserted, skippedUnmapped, maxIngestedAt } = await ingestPositions(
      provider.key, provider.accountRef, positions);
    // A partly-covered window must not move the watermark at all, or the
    // vehicles whose reports failed lose it for good.
    const advanceTo = fetched.complete ? (maxIngestedAt ?? last) : last;

    // Authenticating cleanly and returning nothing is the failure mode that
    // otherwise hides for weeks — it looks exactly like a healthy tick.
    //
    // Gated on activeTrackers (mapped NOW), not recon.upserted (mapped BY THIS
    // TICK): a dying session that returns [] from listVehicles never throws and
    // never upserts anything, so recon.upserted alone would stay 0 forever on a
    // total outage while existing mappings sit untouched — total silence.
    //
    // Discovery health is part of this, and cannot be inferred from position
    // volume. fetchPositions reads ALREADY-MAPPED trackers, so when a portal
    // reformat makes the vehicle list match nothing, positions keep flowing
    // from the previous tick's mappings and a volume-only check stays quiet
    // forever while every newly added or renamed vehicle silently stops being
    // trackable. Same for the wholesale-unmapping brake: an engaged safety
    // brake is the single most important thing this job can tell anyone, and
    // logging it is not telling anyone.
    const gapReason =
      portalVehicles.length === 0
        ? `portal returned an empty vehicle list while ${activeTrackers} trackers remain mapped`
        : recon.matchedNone
          ? `portal returned ${portalVehicles.length} vehicles but none could be mapped — registration format drift or a report-tree change`
          : recon.deactivationSuppressed
            ? `refused to unmap ${activeTrackers} trackers: this tick matched only ${recon.upserted}`
            : positions.length === 0
              ? `${activeTrackers} vehicles mapped but the report returned no positions`
              : null;
    const gap = activeTrackers > 0 && gapReason !== null;
    const gapDetail = gapReason ?? '';

    // Two explicit statements rather than one with a conditional fragment: this
    // repo's SQL tag cannot carry `${cond ? sql`..` : sql``}`.
    //
    // The gap branch INCREMENTS consecutive_failures instead of resetting it,
    // which is what lets decideAlert() suppress a sustained outage after the
    // first notice. The counter still means "consecutive ticks that produced no
    // data", and a genuinely healthy tick below resets it to 0.
    let gapTicks = 0;
    if (gap) {
      const bumped = await sql<{ consecutive_failures: number }>`
        INSERT INTO fleet_tracking_watermarks
          (provider, account_ref, last_event_ts, last_run_at, last_error, consecutive_failures)
        VALUES (${provider.key}, ${provider.accountRef}, ${advanceTo}, now(), ${gapDetail}, 1)
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
        VALUES (${provider.key}, ${provider.accountRef}, ${advanceTo}, now(), NULL, 0)
        ON CONFLICT (provider, account_ref) DO UPDATE
          SET last_event_ts = COALESCE(EXCLUDED.last_event_ts, fleet_tracking_watermarks.last_event_ts),
              last_run_at = now(), last_error = NULL, consecutive_failures = 0
      `;
    }

    if (gap) {
      log.warn('[poll-portal-tracking] gap: mapped vehicles but no usable portal data', {
        provider: provider.key, accountRef: provider.accountRef,
        activeTrackers, portalVehicleCount: portalVehicles.length,
        positionCount: positions.length, reason: gapDetail, gapTicks });
      await raiseTrackingAlert({
        kind: 'gap',
        consecutiveFailures: gapTicks,
        nowSast: now,
        provider: provider.key,
        accountRef: provider.accountRef,
        detail: gapDetail,
      });
    }

    // A partial fetch is a degraded tick even when it produced data: reported
    // as transient so a portal that keeps dropping one vehicle eventually says
    // so, rather than looking healthy because the other twenty-one worked.
    if (!fetched.complete) {
      await raiseTrackingAlert({
        kind: 'transient',
        consecutiveFailures: (wm[0]?.consecutive_failures ?? 0) + 1,
        nowSast: now,
        provider: provider.key,
        accountRef: provider.accountRef,
        detail: fetched.detail ?? 'partial fetch',
      });
    }

    log.info('[poll-portal-tracking] polled', {
      provider: provider.key, accountRef: provider.accountRef,
      fetched: positions.length, inserted, skippedUnmapped, complete: fetched.complete,
      mapped: recon.upserted, activeTrackers, deactivated: recon.deactivated,
      deactivationSuppressed: recon.deactivationSuppressed,
      skippedOtherProvider: recon.skippedOtherProvider.length,
      ambiguous: recon.ambiguous.length,
      fleetOnly: recon.fleetOnly.length, portalOnly: recon.portalOnly.length });

    return {
      provider: provider.key, accountRef: provider.accountRef,
      inserted, skippedUnmapped, complete: fetched.complete,
      coverage: {
        mapped: recon.upserted,
        activeTrackers,
        notOnPortal: recon.fleetOnly.map((f) => f.registration),
        unknownOnPortal: recon.portalOnly.map((p) => p.externalId),
        alreadyTrackedElsewhere: recon.skippedOtherProvider.map((s) => s.registration),
        ambiguous: recon.ambiguous,
        deactivationSuppressed: recon.deactivationSuppressed,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const auth = isAuthFailure(message);
    // Watermark deliberately untouched — the next tick retries the same window,
    // so a transient outage loses no data. This INSERT omits last_event_ts
    // entirely, so ON CONFLICT never overwrites it.
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
    return {
      provider: provider.key, accountRef: provider.accountRef,
      error: message, authFailure: auth };
  }
}
