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
  /** Enforces one-active-tracker-per-vehicle. Must run before upsertTracker. */
  deactivateOthersForVehicle: (
    vehicleId: string, provider: ProviderKey, accountRef: string, externalId: string
  ) => Promise<void>;
  upsertTracker: (
    provider: ProviderKey, accountRef: string, externalId: string, vehicleId: string
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
   * on (vehicle_id) WHERE is_active. Activating a second tracker for a vehicle
   * that already has one violates it and throws, taking the whole poll down.
   *
   * Newest wins: a vehicle moving between rental partners gets a new device and
   * the old one stops reporting, so the freshly discovered tracker is the
   * truthful one. This must run BEFORE the upsert — the reverse order trips the
   * very index it exists to respect.
   */
  deactivateOthersForVehicle: async (vehicleId, provider, accountRef, externalId) => {
    await sql`
      UPDATE fleet_vehicle_trackers
      SET is_active = false, updated_at = now()
      WHERE vehicle_id = ${vehicleId}
        AND is_active
        AND NOT (provider = ${provider} AND account_ref = ${accountRef} AND external_id = ${externalId})
    `;
  },

  upsertTracker: async (provider, accountRef, externalId, vehicleId) => {
    await sql`
      INSERT INTO fleet_vehicle_trackers
        (vehicle_id, provider, account_ref, external_id, is_active, created_at, updated_at)
      VALUES (${vehicleId}, ${provider}, ${accountRef}, ${externalId}, true, now(), now())
      ON CONFLICT (provider, account_ref, external_id) DO UPDATE
        SET vehicle_id = EXCLUDED.vehicle_id, is_active = true, updated_at = now()
    `;
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
  const { matched, portalOnly, fleetOnly } = matchVehicles(portal, fleet);

  for (const m of matched) {
    // Order is load-bearing: see deactivateOthersForVehicle.
    await deps.deactivateOthersForVehicle(m.vehicleId, provider, accountRef, m.externalId);
    await deps.upsertTracker(provider, accountRef, m.externalId, m.vehicleId);
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
