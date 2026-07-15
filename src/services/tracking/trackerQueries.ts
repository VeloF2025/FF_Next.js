/**
 * Read/write access to fleet_vehicle_trackers — the single source of truth
 * for which tracker reports for which vehicle. Replaces the old
 * fleet_vehicles.cartrack_vehicle_id column (dropped in migration 441).
 */
import { sql } from '@/lib/db-pool';

export interface VehicleTrackerRow extends Record<string, unknown> {
  vehicle_id: string;
  registration: string;
  external_id: string | null;
}

/**
 * Point a vehicle at a tracker. Deactivates any existing active tracker
 * first — the partial unique index permits only one active row per vehicle,
 * so ordering matters. Passing externalId=null unmaps without re-inserting.
 */
export async function setVehicleTracker(args: {
  vehicleId: string;
  provider: string;
  accountRef: string;
  externalId: string | null;
}): Promise<void> {
  const { vehicleId, provider, accountRef, externalId } = args;

  await sql`
    UPDATE fleet_vehicle_trackers
    SET is_active = false, updated_at = now()
    WHERE vehicle_id = ${vehicleId} AND is_active
  `;

  if (externalId === null) return;

  await sql`
    INSERT INTO fleet_vehicle_trackers (vehicle_id, provider, account_ref, external_id, is_active)
    VALUES (${vehicleId}, ${provider}, ${accountRef}, ${externalId}, true)
    ON CONFLICT (provider, account_ref, external_id)
    DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id, is_active = true, updated_at = now()
  `;
}

/** Every vehicle with its active tracker for this provider, if any. */
export async function listVehicleTrackers(provider: string): Promise<VehicleTrackerRow[]> {
  return sql<VehicleTrackerRow>`
    SELECT v.id AS vehicle_id, v.registration, t.external_id
    FROM fleet_vehicles v
    LEFT JOIN fleet_vehicle_trackers t
      ON t.vehicle_id = v.id AND t.is_active AND t.provider = ${provider}
    WHERE v.status = 'active'
    ORDER BY v.registration
  `;
}
