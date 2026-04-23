/**
 * Cartrack API adapter types.
 *
 * Cartrack's REST API uses Basic Auth over HTTPS with tenant-scoped
 * endpoints. We only depend on two response shapes here:
 *
 *   - Historical position: a timestamped lat/lon sample, 30–120s spacing.
 *   - Vehicle list: an array of { id, registration } for the mapping UI.
 *
 * Exact endpoint paths live alongside the CARTRACK_BASE_URL env var;
 * keeping them external means a sandbox vs. production swap is env-only.
 */

export interface CartrackPositionSample {
  /** Cartrack's opaque vehicle identifier (stored in fleet_vehicles.cartrack_vehicle_id). */
  vehicleId: string;
  lat: number;
  lon: number;
  /** Sample timestamp from the Cartrack device. */
  ts: Date;
}

export type CartrackFetchResult =
  | { status: 'ok'; sample: CartrackPositionSample }
  | { status: 'no_data' }
  | { status: 'vehicle_not_mapped' };

export interface CartrackVehicleSummary {
  /** Cartrack's opaque vehicle identifier. */
  cartrackId: string;
  /** License plate as Cartrack knows it (may differ slightly from fleet_vehicles.registration). */
  registration: string | null;
  description: string | null;
}

export interface CartrackClient {
  /**
   * Returns the position sample nearest to `at` within ±`toleranceMs`.
   * Returns `no_data` if no sample falls inside the window, or
   * `vehicle_not_mapped` if Cartrack replies 404 / empty for the id.
   */
  fetchPositionAt(
    vehicleId: string,
    at: Date,
    toleranceMs?: number
  ): Promise<CartrackFetchResult>;

  /**
   * Lists vehicles in the tenant's fleet. Used by the one-time mapping
   * admin page to suggest candidates by registration match.
   */
  listVehicles(): Promise<CartrackVehicleSummary[]>;
}
