/**
 * Read/write access to fleet_vehicle_trackers — the single source of truth
 * for which tracker reports for which vehicle. Supersedes the old
 * fleet_vehicles.cartrack_vehicle_id column, which nothing reads once this
 * ships but is dropped by a later migration: dev and prod share one database
 * and the deploy applies migrations before the new code is serving, so
 * dropping it in this release would break prod's still-running old code.
 */
import { transaction } from '@/lib/db-pool';

/**
 * Point a vehicle at a tracker. Deactivates any existing active tracker
 * first — the partial unique index permits only one active row per vehicle,
 * so ordering matters. Passing externalId=null unmaps without re-inserting.
 * Both statements run in a single transaction so a failing insert (e.g. an
 * over-length external_id) cannot leave the vehicle unmapped.
 *
 * Note: because (provider, account_ref, external_id) is unique, re-pointing
 * a tracker already active on another vehicle (the ON CONFLICT DO UPDATE)
 * silently steals it — that vehicle's row is deactivated/reassigned and this
 * call still returns success. This is intentional (a physical tracker really
 * did move) but is a silent side effect worth knowing about.
 */
export async function setVehicleTracker(args: {
  vehicleId: string;
  provider: string;
  accountRef: string;
  externalId: string | null;
}): Promise<void> {
  const { vehicleId, provider, accountRef, externalId } = args;

  await transaction(async (txn) => {
    await txn.query(
      `UPDATE fleet_vehicle_trackers
          SET is_active = false, updated_at = now()
        WHERE vehicle_id = $1 AND is_active`,
      [vehicleId]
    );

    if (externalId === null) return;

    await txn.query(
      `INSERT INTO fleet_vehicle_trackers (vehicle_id, provider, account_ref, external_id, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (provider, account_ref, external_id)
       DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id, is_active = true, updated_at = now()`,
      [vehicleId, provider, accountRef, externalId]
    );
  });
}
