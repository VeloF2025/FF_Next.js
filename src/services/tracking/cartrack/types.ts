/**
 * Cartrack Fleet API adapter types.
 *
 * Tenant-scoped REST with HTTP Basic Auth (per
 * https://developer.cartrack.com/docs/fleet-api-general/authentication).
 * Two endpoints load-bearing for Phase 2:
 *
 *   - GET /vehicles                    — fleet list (for the mapping UI)
 *   - GET /vehicles/events             — per-ping historical GPS samples
 *                                        across ALL vehicles in a ≤24h window.
 *                                        We filter by `vehicle_id` in-memory.
 *
 * CARTRACK_BASE_URL should include the `/rest` suffix:
 *   https://fleetapi-za.cartrack.com/rest
 *
 * Note on vehicle identifiers:
 *   Cartrack's REST shape returns BOTH `vehicle_id` (opaque integer) AND
 *   `registration`. The `registration` value in the SA tenant is an
 *   INTERNAL placeholder like `TEMP-2084956`; the actual license plate is
 *   stored in `vehicle_name`. Our mapping stores Cartrack's `vehicle_id`
 *   as a string and surfaces `vehicle_name` as the human plate in the
 *   mapping UI.
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
  /**
   * The actual license plate as Cartrack displays it in Fleetweb. Maps
   * from Cartrack's `vehicle_name` field, not the misnamed `registration`
   * field (which holds internal `TEMP-XXXXX` placeholders in the SA tenant).
   */
  registration: string | null;
  description: string | null;
}

export interface CartrackClient {
  /**
   * Returns the position sample nearest to `at` within ±`toleranceMs`,
   * for the vehicle identified by `vehicleId` (Cartrack's opaque integer,
   * passed as a string).
   *
   * Implementation calls `GET /vehicles/events` for the window
   * [at - tolerance, at + tolerance] and filters returned events by
   * `vehicle_id`. Returns:
   *   - `ok` with the nearest-by-timestamp sample.
   *   - `no_data` if the window returned events but none for this vehicle,
   *     or if the vehicle's events all lie outside the tolerance.
   *   - `vehicle_not_mapped` is NOT produced by this endpoint. Cartrack's
   *     events endpoint returns no matching rows (not 404) for unknown
   *     vehicles, which surfaces as `no_data`. The `vehicle_not_mapped`
   *     verdict is owned by the reconcile orchestrator and produced
   *     upstream when `cartrack_vehicle_id IS NULL` short-circuits
   *     before calling this method. The union variant is kept in the
   *     return type so test doubles + other clients can emit it.
   *
   * @param vehicleId — Cartrack vehicle_id as a non-empty string. Empty
   *   strings throw `CartrackError(config)` to prevent false matches
   *   against payloads with null vehicle_id.
   * @param at — MUST be a UTC-anchored Date (e.g. constructed from an
   *   ISO-8601 string with TZ, or from a Postgres TIMESTAMPTZ round-trip).
   *   A local-time Date would skew the request window; no defensive
   *   guard is cheap enough to add here, so callers are on the honour
   *   system. All paths in this project construct Dates from TZ-anchored
   *   strings or `new Date()` (UTC-native).
   * @param toleranceMs — ±window for nearest-sample pick. Default 5 min.
   */
  fetchPositionAt(
    vehicleId: string,
    at: Date,
    toleranceMs?: number
  ): Promise<CartrackFetchResult>;

  /**
   * Lists vehicles in the tenant's fleet. Used by the one-time mapping
   * admin page to suggest candidates by registration match. Surfaces the
   * Cartrack `vehicle_name` as the human-readable plate (see note above).
   */
  listVehicles(): Promise<CartrackVehicleSummary[]>;
}
