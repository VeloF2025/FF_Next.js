/**
 * Reconciles a portal's vehicle list against fleet_vehicles.
 *
 * Coverage as a continuously verified property rather than a number somebody
 * counted once: before every poll it answers which of our vehicles this portal
 * is not carrying, and which of its vehicles we do not recognise. Both
 * directions matter — the reverse one surfaced a live Cartrack subscription
 * attached to no identifiable vehicle, and two retired vehicles still tracked.
 *
 * A tracker row is written ONLY for a confident registration match. Guessing
 * would attribute one vehicle's movements to another, which is worse than
 * having no data at all.
 */
import { sql, query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { setVehicleTracker } from './trackerQueries';
import {
  matchVehicles,
  type FleetVehicleRow,
  type MatchResult,
  type PortalVehicle,
} from './portal/registration';
import type { ProviderKey } from './types';

export interface ReconcileReport {
  upserted: number;
  deactivated: number;
  portalOnly: PortalVehicle[];
  fleetOnly: FleetVehicleRow[];
  /**
   * True when deactivation was refused because this reconcile would have
   * unmapped half or more of the account's active trackers. Surfaced rather
   * than swallowed: a suppressed run leaves stale mappings in place on
   * purpose, and whoever reads the poll output has to be able to see that a
   * safety brake engaged instead of inferring health from `deactivated: 0`.
   */
  deactivationSuppressed: boolean;
  /**
   * True when the portal returned vehicles but none of them could be placed —
   * or when everything placeable was skipped. Distinct from `upserted: 0`,
   * which is also what a healthy already-mapped account looks like.
   */
  matchedNone: boolean;
  /**
   * Vehicles this portal carries that are already tracked by a DIFFERENT
   * provider or account, and were therefore left alone. See the takeover
   * comment below.
   */
  skippedOtherProvider: Array<{ vehicleId: string; registration: string }>;
  /** Normalised keys that collided in either direction — see MatchResult.ambiguous. */
  ambiguous: MatchResult['ambiguous'];
}

/**
 * At or above this share of the account's active trackers, a deactivation is
 * treated as a portal/parsing fault rather than as truth. Half is deliberately
 * blunt: fleets do not lose half their trackers between two ticks two hours
 * apart, but a shape change or a registration-format drift removes exactly
 * that much in one go — so the boundary itself must be suppressed, not allowed
 * through. A report truncated to the first of two equal pages lands precisely
 * on it.
 */
const MAX_DEACTIVATION_SHARE = 0.5;

export interface ReconcileDeps {
  loadActiveFleet: () => Promise<FleetVehicleRow[]>;
  /**
   * Deactivates the vehicle's other active tracker and activates this one in
   * a single transaction. Must stay atomic: uq_fleet_trackers_one_active_per_vehicle
   * permits exactly one active row per vehicle, and if a deactivate and a
   * separate upsert were split across two statements, a failure between them
   * could leave the vehicle with zero active trackers until the next
   * successful reconcile — during which ingest.ts silently discards every
   * position for it. Do not split this back into two calls.
   */
  assignTracker: (
    vehicleId: string, provider: ProviderKey, accountRef: string, externalId: string
  ) => Promise<void>;
  deactivateMissing: (
    provider: ProviderKey, accountRef: string, keepExternalIds: string[]
  ) => Promise<number>;
  /**
   * How many trackers are active for this provider/account right now, read
   * before anything is written. This is the denominator for the wholesale
   * -unmapping brake — a dep rather than an inline query so the brake stays
   * testable without a database.
   */
  countActiveTrackers: (provider: ProviderKey, accountRef: string) => Promise<number>;
  /**
   * Vehicle ids that currently hold an active tracker belonging to some OTHER
   * provider/account. The takeover guard's input; a dep so it is testable
   * without a database.
   */
  loadTrackedElsewhere: (provider: ProviderKey, accountRef: string) => Promise<Set<string>>;
}

const dbDeps: ReconcileDeps = {
  loadActiveFleet: async () => {
    const rows = await sql<{ id: string; registration: string }>`
      SELECT id, registration FROM fleet_vehicles
      WHERE status = 'active' AND registration IS NOT NULL AND btrim(registration) <> ''
      ORDER BY registration
    `;
    return rows.map((r) => ({ id: r.id, registration: r.registration }));
  },

  /**
   * The DB enforces uq_fleet_trackers_one_active_per_vehicle — a UNIQUE index
   * on (vehicle_id) WHERE is_active. Delegates to setVehicleTracker (see
   * trackerQueries.ts), which runs the deactivate-then-upsert sequence inside
   * one transaction so a failure between the two statements cannot leave the
   * vehicle with zero active trackers.
   *
   * Newest wins WITHIN a provider account: a vehicle moving between rental
   * partners gets a new device and the old one stops reporting, so the freshly
   * discovered tracker is the truthful one. Across providers it is the caller's
   * job to have filtered first — see loadTrackedElsewhere.
   */
  assignTracker: async (vehicleId, provider, accountRef, externalId) => {
    await setVehicleTracker({ vehicleId, provider, accountRef, externalId });
  },

  deactivateMissing: async (provider, accountRef, keep) => {
    // Raw query, not a tagged template: a conditional fragment for the empty
    // -array case breaks this repo's SQL tag (see CLAUDE.md), so the two cases
    // are separate statements.
    const text = keep.length
      ? `UPDATE fleet_vehicle_trackers SET is_active = false, updated_at = now()
         WHERE provider = $1 AND account_ref = $2 AND is_active AND NOT (external_id = ANY($3))
         RETURNING id`
      : `UPDATE fleet_vehicle_trackers SET is_active = false, updated_at = now()
         WHERE provider = $1 AND account_ref = $2 AND is_active
         RETURNING id`;
    const params = keep.length ? [provider, accountRef, keep] : [provider, accountRef];
    return (await query(text, params)).length;
  },

  countActiveTrackers: async (provider, accountRef) => {
    const rows = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM fleet_vehicle_trackers
      WHERE provider = ${provider} AND account_ref = ${accountRef} AND is_active
    `;
    return rows[0]?.n ?? 0;
  },

  loadTrackedElsewhere: async (provider, accountRef) => {
    const rows = await sql<{ vehicle_id: string }>`
      SELECT DISTINCT vehicle_id FROM fleet_vehicle_trackers
      WHERE is_active
        AND NOT (provider = ${provider} AND account_ref = ${accountRef})
    `;
    return new Set(rows.map((r) => r.vehicle_id));
  },
};

export async function reconcileTrackers(
  provider: ProviderKey,
  accountRef: string,
  portal: PortalVehicle[],
  deps: ReconcileDeps = dbDeps
): Promise<ReconcileReport> {
  const fleet = await deps.loadActiveFleet();
  const empty = {
    upserted: 0, deactivated: 0, deactivationSuppressed: false,
    skippedOtherProvider: [] as ReconcileReport['skippedOtherProvider'],
  };

  // An empty portal list is treated as a fetch failure, not as truth about the
  // account. listVehicles() can return [] for reasons that have nothing to do
  // with the account genuinely having no vehicles — a dead session, a shape
  // change, an auth redirect parsed as an empty body — and reconciling against
  // that would deactivate every active tracker on the account in one call,
  // silently blacking out ingestion for the whole fleet. Bail out before
  // touching any tracker row.
  if (portal.length === 0) {
    log.warn('[tracking-discovery] empty portal vehicle list — treating as fetch failure, not reconciling', {
      provider, accountRef,
    });
    return {
      ...empty, portalOnly: [], fleetOnly: fleet, matchedNone: true, ambiguous: [],
    };
  }

  const { matched, portalOnly, fleetOnly, ambiguous } = matchVehicles(portal, fleet);

  // A non-empty list that matches NOTHING is the same class of failure as an
  // empty one, and the empty-list guard above does not catch it. listVehicles()
  // reads a report TREE on a multi-client reseller account: its top level can
  // legitimately be client/group folder nodes, which carry {id, name}, pass the
  // client's runtime validator, and match no registration we own. A change in
  // how the portal formats registrations ("LN40MGGP - Hilux") does the same.
  // In either case `matched` is [] and deactivateMissing([]) takes its
  // unfiltered branch, switching off EVERY active tracker on the account —
  // blacking out ingestion while the tick still reports 200. Zero matches is
  // never truth about a fleet we know has vehicles; it is a parse failure.
  if (matched.length === 0) {
    log.warn('[tracking-discovery] portal list matched no fleet vehicle — treating as fetch failure, not reconciling', {
      provider, accountRef,
      portalCount: portal.length,
      sampleExternalIds: portal.slice(0, 5).map((p) => p.externalId),
      sampleNames: portal.slice(0, 5).map((p) => p.registration),
    });
    return {
      ...empty, portalOnly: portal, fleetOnly: fleet, matchedNone: true, ambiguous,
    };
  }

  // NEVER take a vehicle off another provider.
  //
  // uq_fleet_trackers_one_active_per_vehicle is fleet-wide, and
  // setVehicleTracker's deactivate is `WHERE vehicle_id = $1 AND is_active`
  // with no provider predicate — so mapping a vehicle Cartrack already tracks
  // switches the Cartrack row off. This portal is a multi-client reseller tree
  // and loadActiveFleet loads the WHOLE fleet, so the collision is expected.
  // The result is a silent downgrade from a 2-minute feed to a 2-hourly
  // scrape: poll-tracking.ts then drops that vehicle's positions as unmapped
  // at log.info, runs no discovery, and nothing ever maps it back. Reported,
  // not hidden — two providers on one vehicle is a subscription paid twice.
  const trackedElsewhere = await deps.loadTrackedElsewhere(provider, accountRef);
  const skippedOtherProvider = matched
    .filter((m) => trackedElsewhere.has(m.vehicleId))
    .map((m) => ({ vehicleId: m.vehicleId, registration: m.registration }));
  const claimable = matched.filter((m) => !trackedElsewhere.has(m.vehicleId));

  if (skippedOtherProvider.length > 0) {
    log.warn('[tracking-discovery] vehicles already tracked by another provider — not taking over', {
      provider, accountRef,
      registrations: skippedOtherProvider.map((s) => s.registration),
    });
  }
  if (ambiguous.length > 0) {
    log.error('[tracking-discovery] ambiguous registration match — refusing to map', {
      provider, accountRef, ambiguous,
    });
  }

  // All of it is already someone else's. Same reasoning as the zero-match
  // guard: proceeding hands deactivateMissing an empty keep list.
  if (claimable.length === 0) {
    log.warn('[tracking-discovery] every matched vehicle is tracked elsewhere — nothing to reconcile', {
      provider, accountRef, skipped: skippedOtherProvider.length,
    });
    return {
      ...empty, portalOnly, fleetOnly, matchedNone: true, ambiguous, skippedOtherProvider,
    };
  }

  // Snapshot taken BEFORE any write: the denominator has to be what the account
  // looked like going in, not what this run has already changed.
  const activeBefore = await deps.countActiveTrackers(provider, accountRef);

  for (const m of claimable) {
    await deps.assignTracker(m.vehicleId, provider, accountRef, m.externalId);
  }

  // The partial case. Matched vehicles keep ingesting, so nothing looks broken
  // and the gap alert cannot fire — yet every unmatched vehicle's positions are
  // discarded as unmapped while the watermark advances past that window. That
  // data does not come back. Refusing to deactivate costs at most some stale
  // rows, which the next healthy tick clears; deactivating wrongly costs
  // history.
  const wouldDeactivate = Math.max(0, activeBefore - claimable.length);
  const deactivationSuppressed =
    wouldDeactivate > 0 && wouldDeactivate >= activeBefore * MAX_DEACTIVATION_SHARE;

  let deactivated = 0;
  if (deactivationSuppressed) {
    log.error('[tracking-discovery] refusing to deactivate: this reconcile would unmap most of the account', {
      provider, accountRef,
      activeBefore, matched: claimable.length, wouldDeactivate,
      portalCount: portal.length,
    });
  } else {
    deactivated = await deps.deactivateMissing(
      provider, accountRef, claimable.map((m) => m.externalId)
    );
  }

  if (fleetOnly.length > 0) {
    log.info('[tracking-discovery] active vehicles not on this portal', {
      provider, accountRef,
      registrations: fleetOnly.map((f) => f.registration),
    });
  }
  if (portalOnly.length > 0) {
    // Sampled, not listed: on a reseller account this is every OTHER company's
    // vehicle (~11.4k ids), which overruns journald's LineMax and bloats the
    // cron log twelve times a day. Count is the signal; five ids show shape.
    log.warn('[tracking-discovery] portal vehicles matching no active fleet vehicle', {
      provider, accountRef,
      count: portalOnly.length,
      sampleExternalIds: portalOnly.slice(0, 5).map((p) => p.externalId),
    });
  }

  return {
    upserted: claimable.length, deactivated, portalOnly, fleetOnly,
    deactivationSuppressed, matchedNone: false, skippedOtherProvider, ambiguous,
  };
}
