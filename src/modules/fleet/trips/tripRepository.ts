/**
 * Persistence for continuously-built trips.
 *
 * A window is REPLACED, not accumulated. `deleteTripsFrom` clears the window being rebuilt and the
 * recomputed trips are then inserted, so the result depends only on the positions -- never on how
 * many times the builder has run over them. The upsert on `(vehicle_id, ignition_on_at)` remains
 * as a second line of defence within a single run.
 *
 * ## The late-arrival lookback
 *
 * Positions carry both `recorded_at` (when the vehicle was there) and `received_at` (when we
 * heard about it). Trackers buffer while out of coverage and flush later, so a position with an
 * OLDER `recorded_at` can land after the watermark has already moved past it. A watermark applied
 * naively to `recorded_at` would step over those rows forever and silently lose the trips they
 * belong to. Watermarking on `received_at` instead would re-order the stream the segmenter depends
 * on being chronological.
 *
 * The lookback alone was not enough: a time-based floor can land in the MIDDLE of a journey, and
 * the rebuild then produced a trip with a different `ignition_on_at` that INSERTed beside the
 * original instead of replacing it. `tripBuildService` therefore pulls the read start back to the
 * last recorded trip's own start, so a window always begins at a trip boundary.
 */
import { query, queryOne } from '@/lib/db-pool';
import type { SegmentedTrip, TripPosition } from './tripSegmenter';

/**
 * How far before the watermark a run reconsiders, to catch positions that arrived late.
 *
 * Sized against the observed sampling: cartrack averages 1.7 minutes between fixes, ituran 72.
 * Six hours covers a tracker that buffered through a long out-of-coverage stretch without making
 * every run rescan the day.
 *
 * NOTE this is only a FLOOR. `tripBuildService` pulls the read start back further, to the start of
 * the last trip it already recorded, so a window never begins in the middle of a journey. A bare
 * time-based lookback bisected trips and minted duplicate fragments -- see the segmenter header.
 */
export const LATE_ARRIVAL_LOOKBACK_MINUTES = 6 * 60;

interface PositionRow extends Record<string, unknown> {
  recorded_at: string | Date;
  ignition: boolean | null;
  lat: string | number | null;
  lon: string | number | null;
  speed_kph: string | number | null;
  odometer_km: string | number | null;
}

/** node-postgres returns NUMERIC as a string to avoid precision loss; coordinates need numbers. */
function num(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export interface TrackedVehicle {
  vehicleId: string;
  trackerId: string | null;
  provider: string | null;
}

/**
 * Vehicles worth building trips for: those with at least one position.
 *
 * Driven by the position stream rather than the vehicle register, because a vehicle without a
 * tracker has nothing to segment - 5 of the 23 active vehicles are in that state, which is a
 * data-collection gap this job cannot close.
 */
export async function listVehiclesWithPositions(): Promise<TrackedVehicle[]> {
  const rows = await query<{ vehicle_id: string; tracker_id: string | null; provider: string | null }>(
    `/* fleet-trips:vehicles */
     SELECT DISTINCT ON (p.vehicle_id)
            p.vehicle_id, p.tracker_id, p.provider
     FROM fleet_vehicle_positions p
     WHERE p.vehicle_id IS NOT NULL
     ORDER BY p.vehicle_id, p.recorded_at DESC`,
    [],
  );
  return rows.map((r) => ({ vehicleId: r.vehicle_id, trackerId: r.tracker_id, provider: r.provider }));
}

/** The newest position already folded into a trip, or null if this vehicle is untouched. */
export async function readWatermark(vehicleId: string): Promise<string | null> {
  const row = await queryOne<{ last_position_at: string | Date | null }>(
    `/* fleet-trips:watermark-read */
     SELECT last_position_at FROM fleet_trip_build_watermarks WHERE vehicle_id = $1`,
    [vehicleId],
  );
  return row?.last_position_at ? iso(row.last_position_at) : null;
}

export async function writeWatermark(
  vehicleId: string, lastPositionAt: string, processed: number,
): Promise<void> {
  await query(
    `/* fleet-trips:watermark-write */
     INSERT INTO fleet_trip_build_watermarks (vehicle_id, last_position_at, last_built_at, positions_processed)
     VALUES ($1, $2::timestamptz, now(), $3)
     ON CONFLICT (vehicle_id) DO UPDATE
       SET last_position_at = GREATEST(
             fleet_trip_build_watermarks.last_position_at, EXCLUDED.last_position_at),
           last_built_at = now(),
           positions_processed = fleet_trip_build_watermarks.positions_processed + EXCLUDED.positions_processed`,
    [vehicleId, lastPositionAt, processed],
  );
}

/**
 * Positions for one vehicle after the watermark, minus the lookback, in chronological order.
 *
 * `limit` bounds a single run so one vehicle with a long backlog cannot starve the others; the
 * caller loops until a run returns fewer rows than it asked for.
 */
export async function loadPositions(
  vehicleId: string, from: string | null, limit: number,
): Promise<TripPosition[]> {
  // Two explicit branches rather than a conditional SQL fragment: interpolated tagged-template
  // conditionals are broken in this repo and silently produce a malformed query.
  const rows = from === null
    ? await query<PositionRow>(
        `/* fleet-trips:positions-all */
         SELECT recorded_at, ignition, lat, lon, speed_kph, odometer_km
         FROM fleet_vehicle_positions
         WHERE vehicle_id = $1
         ORDER BY recorded_at, id
         LIMIT $2`,
        [vehicleId, limit],
      )
    : await query<PositionRow>(
        `/* fleet-trips:positions-from */
         SELECT recorded_at, ignition, lat, lon, speed_kph, odometer_km
         FROM fleet_vehicle_positions
         WHERE vehicle_id = $1
           AND recorded_at >= $2::timestamptz
         ORDER BY recorded_at, id
         LIMIT $3`,
        [vehicleId, from, limit],
      );

  return rows.map((r) => ({
    recordedAt: iso(r.recorded_at),
    ignition: r.ignition,
    lat: num(r.lat),
    lon: num(r.lon),
    speedKph: num(r.speed_kph),
    odometerKm: num(r.odometer_km),
  }));
}



/**
 * The `ignition_on_at` of the most recent trip recorded for this vehicle, whatever its state.
 *
 * The build anchors its read window at or before this, so a window never begins inside a journey
 * already on record. Deliberately NOT restricted to open trips: a trip closed as `timeout` at a
 * previous batch boundary must also be reconsidered, or it stays truncated forever.
 */
export async function loadLastTripStart(vehicleId: string): Promise<string | null> {
  const row = await queryOne<{ ignition_on_at: string | Date }>(
    `/* fleet-trips:last-trip-start */
     SELECT ignition_on_at FROM fleet_vehicle_trips
     WHERE vehicle_id = $1
     ORDER BY ignition_on_at DESC
     LIMIT 1`,
    [vehicleId],
  );
  return row ? iso(row.ignition_on_at) : null;
}

/**
 * Removes every trip for this vehicle at or after `from`, so the window can be replaced wholesale.
 *
 * This is what reaps orphan fragments. Upserting alone could not: a rebuild whose window began at
 * a different point produced a trip with a different `ignition_on_at` -- the conflict key -- so it
 * INSERTed beside the old row instead of replacing it, and one journey accumulated into three
 * metric-eligible trips across successive runs. Deleting the window first makes the recomputed set
 * authoritative.
 *
 * Bounded by `from`, which the caller anchors at a trip boundary, so this never touches history
 * outside the window being rebuilt.
 */
export async function deleteTripsFrom(vehicleId: string, from: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `/* fleet-trips:delete-window */
     DELETE FROM fleet_vehicle_trips
     WHERE vehicle_id = $1 AND ignition_on_at >= $2::timestamptz
     RETURNING id`,
    [vehicleId, from],
  );
  return rows.length;
}

const UPSERT_SQL = `/* fleet-trips:upsert */
  INSERT INTO fleet_vehicle_trips (
    vehicle_id, tracker_id, provider,
    ignition_on_at, ignition_off_at, close_reason,
    on_lat, on_lon, off_lat, off_lon,
    duration_seconds, moving_seconds, idle_seconds,
    distance_km, max_speed_kph, start_odometer_km, end_odometer_km, position_count
  ) VALUES (
    $1, $2, $3, $4::timestamptz, $5::timestamptz, $6,
    $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
  )
  ON CONFLICT (vehicle_id, ignition_on_at) DO UPDATE SET
    ignition_off_at = EXCLUDED.ignition_off_at,
    close_reason = EXCLUDED.close_reason,
    off_lat = EXCLUDED.off_lat,
    off_lon = EXCLUDED.off_lon,
    duration_seconds = EXCLUDED.duration_seconds,
    moving_seconds = EXCLUDED.moving_seconds,
    idle_seconds = EXCLUDED.idle_seconds,
    distance_km = EXCLUDED.distance_km,
    max_speed_kph = EXCLUDED.max_speed_kph,
    start_odometer_km = EXCLUDED.start_odometer_km,
    end_odometer_km = EXCLUDED.end_odometer_km,
    position_count = EXCLUDED.position_count,
    updated_at = now()`;

/**
 * Writes trips for one vehicle.
 *
 * Deliberately does NOT touch the location columns: those are owned by the address resolver, and
 * overwriting them here would discard resolved addresses every time a run re-processed a trip
 * within the lookback window.
 */
export async function upsertTrips(
  vehicle: TrackedVehicle, trips: readonly SegmentedTrip[],
): Promise<number> {
  for (const t of trips) {
    await query(UPSERT_SQL, [
      vehicle.vehicleId, vehicle.trackerId, vehicle.provider,
      t.ignitionOnAt, t.ignitionOffAt, t.closeReason,
      t.onLat, t.onLon, t.offLat, t.offLon,
      t.durationSeconds, t.movingSeconds, t.idleSeconds,
      t.distanceKm, t.maxSpeedKph, t.startOdometerKm, t.endOdometerKm, t.positionCount,
    ]);
  }
  return trips.length;
}
