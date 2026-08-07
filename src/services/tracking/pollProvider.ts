/**
 * One provider's tick: reconcile, fetch, ingest, move the watermark, alert.
 *
 * Extracted from the route so that is only auth, the lock and the loop. A
 * provider that fails returns an error entry rather than throwing — one
 * provider must never take the others down with it.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { netstarFromEnv } from '@/services/tracking/netstar/config';
import { fetchTolerantly } from '@/services/tracking/fetchTolerantly';
import { cartrackPortalFromEnv } from '@/services/tracking/cartrack/portalConfig';
import { reconcileTrackers } from '@/services/tracking/discovery';
import { ingestPositions } from '@/services/tracking/ingest';
import { raiseTrackingAlert } from '@/services/tracking/alerts';
import { decideGapReason } from '@/services/tracking/gapReason';
import type { PortalVehicle } from '@/services/tracking/portal/registration';
import { isAuthFailure, isSameFailureKind } from '@/services/tracking/authFailure';
import { authBreakerDecision, logProbe, reportThrottled } from '@/services/tracking/authBreaker';
import type { TrackingProvider } from '@/services/tracking/types';

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
  /**
   * Newest fix anywhere on the provider's account — the dead-feed probe for
   * snapshot providers. Optional: history providers do not need it, because for
   * them an empty window genuinely means nothing happened.
   */
  feedFreshness?: () => Promise<Date | null>;
}

/**
 * How stale the WHOLE account may go before a snapshot provider's feed counts
 * as dead. Three poll cycles: long enough not to trip on a quiet early morning,
 * short enough to catch a blackout the same working day. See gapReason.ts.
 */
const STALE_FEED_MS = 6 * 60 * 60 * 1000;

export function configuredProviders(): ConfiguredProvider[] {
  const out: ConfiguredProvider[] = [];
  const netstar = netstarFromEnv();
  if (netstar) out.push(netstar);

  // The fleetweb PORTAL, not the REST API poll-tracking.ts uses — see
  // cartrack/portalConfig.ts. A portal scrape, so it rides this cadence.
  const cartrackPortal = cartrackPortalFromEnv();
  if (cartrackPortal) out.push(cartrackPortal);

  return out;
}


export async function pollProvider(
  { provider, listVehicles, feedFreshness }: ConfiguredProvider
): Promise<Record<string, unknown>> {
  let priorError = '';   // hoisted: the catch compares failure kinds
  try {
    // Read the watermark FIRST — before anything that authenticates, so a
    // known-bad credential never spends another login attempt. See
    // isAuthCircuitOpen for why that matters.
    const wm = await sql<{
      last_event_ts: Date | null;
      consecutive_failures: number;
      last_error: string | null;
      last_run_at: Date | null;
    }>`
      SELECT last_event_ts, consecutive_failures, last_error, last_run_at
      FROM fleet_tracking_watermarks
      WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef}
    `;
    const failures = wm[0]?.consecutive_failures ?? 0;
    priorError = wm[0]?.last_error ?? '';
    // Half-open on a cooldown, NOT a latch: while throttled the tick is skipped
    // without writing the watermark, so a permanently-skipping breaker would
    // freeze consecutive_failures and block the only path that could ever clear
    // it. Letting one probe through per cooldown is what makes a fixed
    // credential heal the provider without anyone editing the database.
    const decision = authBreakerDecision(
      failures, priorError, wm[0]?.last_run_at ? new Date(wm[0].last_run_at) : null);
    if (decision.state === 'open' || decision.state === 'hard-stop') {
      return reportThrottled(provider.key, provider.accountRef, decision, priorError);
    }
    if (decision.state === 'half-open') logProbe(provider.key, provider.accountRef, decision.failures);
    const portalVehicles = await listVehicles();
    const recon = await reconcileTrackers(provider.key, provider.accountRef, portalVehicles);

    // Not recon.upserted: that is 0 both on a fresh account AND on a dying
    // session that never reached a real vehicle list. Only the current count of
    // already-mapped trackers tells those apart.
    const trackerRows = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM fleet_vehicle_trackers
      WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef} AND is_active
    `;
    const activeTrackers = trackerRows[0]?.n ?? 0;

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

    // Staleness of the WHOLE account is the dead-feed probe for snapshot
    // providers; see decideGapReason for why an empty result cannot be.
    const staleFeedAt =
      provider.granularity === 'snapshot' && feedFreshness !== undefined
        ? await feedFreshness()
        : null;
    const gapReason = decideGapReason({
      granularity: provider.granularity,
      portalVehicleCount: portalVehicles.length,
      activeTrackers,
      matchedNone: recon.matchedNone,
      deactivationSuppressed: recon.deactivationSuppressed,
      positionCount: positions.length,
      feedAgeMs: staleFeedAt ? now.getTime() - staleFeedAt.getTime() : null,
      staleFeedMs: STALE_FEED_MS,
    });
    const gap = gapReason !== null;
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

    // A partial fetch is degraded even when it produced data: reported as
    // transient so a portal dropping one vehicle eventually says so.
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
        // Count plus a sample: the full list is every other company on the
        // reseller tree, and this body is curled straight into a log file.
        unknownOnPortalCount: recon.portalOnly.length,
        unknownOnPortal: recon.portalOnly.slice(0, 5).map((p) => p.externalId),
        alreadyTrackedElsewhere: recon.skippedOtherProvider.map((s) => s.registration),
        ambiguous: recon.ambiguous,
        deactivationSuppressed: recon.deactivationSuppressed,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Restarts the streak at 1 when the failure kind changes — see
    // isSameFailureKind for why the gap branch makes that necessary.
    const sameKind = isSameFailureKind(message, priorError);
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
            consecutive_failures = CASE WHEN ${sameKind}::boolean
              THEN fleet_tracking_watermarks.consecutive_failures + 1 ELSE 1 END
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
