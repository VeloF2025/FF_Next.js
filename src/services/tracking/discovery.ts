/**
 * Reconciles a portal's vehicle list against fleet_vehicles.
 *
 * This is what makes coverage a continuously verified property rather than a
 * number somebody counted once. It runs before every poll and answers, every
 * time: which of our vehicles is this portal not carrying, and which of its
 * vehicles do we not recognise?
 *
 * Both directions matter. During recon the reverse direction surfaced a live
 * Cartrack subscription attached to no identifiable vehicle, and two retired
 * vehicles still being tracked on a partner's account.
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
   * unmapped more than half the account's active trackers. Surfaced rather
   * than swallowed: a suppressed run leaves stale mappings in place on
   * purpose, and whoever reads the poll output has to be able to see that a
   * safety brake engaged instead of inferring health from `deactivated: 0`.
   */
  deactivationSuppressed: boolean;
}

/**
 * Above this share of the account's active trackers, a deactivation is
 * treated as a portal/parsing fault rather than as truth. Half is deliberately
 * blunt: fleets do not lose half their trackers between two ticks two hours
 * apart, but a shape change or a registration-format drift removes exactly
 * that much in one go.
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
   * Newest wins: a vehicle moving between rental partners gets a new device
   * and the old one stops reporting, so the freshly discovered tracker is the
   * truthful one.
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
};

export async function reconcileTrackers(
  provider: ProviderKey,
  accountRef: string,
  portal: PortalVehicle[],
  deps: ReconcileDeps = dbDeps
): Promise<ReconcileReport> {
  const fleet = await deps.loadActiveFleet();

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
      upserted: 0, deactivated: 0, portalOnly: [], fleetOnly: fleet,
      deactivationSuppressed: false,
    };
  }

  const { matched, portalOnly, fleetOnly } = matchVehicles(portal, fleet);

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
      upserted: 0, deactivated: 0, portalOnly: portal, fleetOnly: fleet,
      deactivationSuppressed: false,
    };
  }

  // Snapshot taken BEFORE any write: the denominator has to be what the account
  // looked like going in, not what this run has already changed.
  const activeBefore = await deps.countActiveTrackers(provider, accountRef);

  for (const m of matched) {
    await deps.assignTracker(m.vehicleId, provider, accountRef, m.externalId);
  }

  // The partial case. Matched vehicles keep ingesting, so nothing looks broken
  // and the gap alert cannot fire — yet every unmatched vehicle's positions are
  // discarded as unmapped while the watermark advances past that window. That
  // data does not come back. Refusing to deactivate costs at most some stale
  // rows, which the next healthy tick clears; deactivating wrongly costs
  // history.
  const wouldDeactivate = Math.max(0, activeBefore - matched.length);
  const deactivationSuppressed = wouldDeactivate > activeBefore * MAX_DEACTIVATION_SHARE;

  let deactivated = 0;
  if (deactivationSuppressed) {
    log.error('[tracking-discovery] refusing to deactivate: this reconcile would unmap most of the account', {
      provider, accountRef,
      activeBefore, matched: matched.length, wouldDeactivate,
      portalCount: portal.length,
    });
  } else {
    deactivated = await deps.deactivateMissing(
      provider, accountRef, matched.map((m) => m.externalId)
    );
  }

  if (fleetOnly.length > 0) {
    log.info('[tracking-discovery] active vehicles not on this portal', {
      provider, accountRef,
      registrations: fleetOnly.map((f) => f.registration),
    });
  }
  if (portalOnly.length > 0) {
    log.warn('[tracking-discovery] portal vehicles matching no active fleet vehicle', {
      provider, accountRef,
      externalIds: portalOnly.map((p) => p.externalId),
    });
  }

  return {
    upserted: matched.length, deactivated, portalOnly, fleetOnly,
    deactivationSuppressed,
  };
}
