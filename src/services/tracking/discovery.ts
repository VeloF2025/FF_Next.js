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
}

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
    return { upserted: 0, deactivated: 0, portalOnly: [], fleetOnly: fleet };
  }

  const { matched, portalOnly, fleetOnly } = matchVehicles(portal, fleet);

  for (const m of matched) {
    await deps.assignTracker(m.vehicleId, provider, accountRef, m.externalId);
  }
  const deactivated = await deps.deactivateMissing(
    provider, accountRef, matched.map((m) => m.externalId)
  );

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

  return { upserted: matched.length, deactivated, portalOnly, fleetOnly };
}
