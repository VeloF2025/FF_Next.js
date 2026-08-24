/**
 * Persistence for continuously-built trips.
 *
 * Every write is idempotent on `(vehicle_id, ignition_on_at)` - the trip's identity - so running
 * the builder twice over the same window updates rows in place rather than duplicating them. That
 * matters more than usual here: the open trip at the end of one run is the same trip the next run
 * closes, and a backfill re-runs windows that the incremental job has already covered.
 *
 * ## The late-arrival lookback
 *
 * Positions carry both `recorded_at` (when the vehicle was there) and `received_at` (when we
 * heard about it). Trackers buffer while out of coverage and flush later, so a position with an
 * OLDER `recorded_at` can land after the watermark has already moved past it. A watermark applied
 * naively to `recorded_at` would step over those rows forever and silently lose the trips they
 * belong to.
 *
 * So each run re-reads a lookback window before the watermark. The upsert makes re-processing
 * free, and the alternative - watermarking on `received_at` - would re-order the stream the
 * segmenter depends on being chronological.
 */
import { query, queryOne } from '@/lib/db-pool';
import type { SegmentedTrip, TripPosition } from './tripSegmenter';

/**
 * How far before the watermark each run re-reads, to catch positions that arrived late.
 *
 * Sized against the observed sampling: cartrack averages 1.7 minutes between fixes, ituran 72.
 * Six hours covers a tracker that buffered through a long out-of-coverage stretch without making
 * every run rescan the day.
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
  vehicleId: string, since: string | null, limit: number,
): Promise<TripPosition[]> {
  // Two explicit branches rather than a conditional SQL fragment: interpolated tagged-template
  // conditionals are broken in this repo and silently produce a malformed query.
  const rows = since === null
    ? await query<PositionRow>(
        `/* fleet-trips:positions-all */
         SELECT recorded_at, ignition, lat, lon, speed_kph, odometer_km
         FROM fleet_vehicle_positions
         WHERE vehicle_id = $1
         ORDER BY recorded_at
         LIMIT $2`,
        [vehicleId, limit],
      )
    : await query<PositionRow>(
        `/* fleet-trips:positions-since */
         SELECT recorded_at, ignition, lat, lon, speed_kph, odometer_km
         FROM fleet_vehicle_positions
         WHERE vehicle_id = $1
           AND recorded_at > ($2::timestamptz - ($3 || ' minutes')::interval)
         ORDER BY recorded_at
         LIMIT $4`,
        [vehicleId, since, String(LATE_ARRIVAL_LOOKBACK_MINUTES), limit],
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

interface OpenTripRow extends Record<string, unknown> {
  ignition_on_at: string | Date;
  on_lat: string | number | null;
  on_lon: string | number | null;
  duration_seconds: string | number | null;
  moving_seconds: string | number | null;
  idle_seconds: string | number | null;
  distance_km: string | number | null;
  max_speed_kph: string | number | null;
  start_odometer_km: string | number | null;
  end_odometer_km: string | number | null;
  position_count: number;
}

/**
 * The one trip left open for this vehicle, so an incremental run continues the journey instead of
 * splitting it at the batch boundary. A partial unique index guarantees there is at most one.
 */
export async function loadOpenTrip(vehicleId: string): Promise<SegmentedTrip | null> {
  const row = await queryOne<OpenTripRow>(
    `/* fleet-trips:open */
     SELECT ignition_on_at, on_lat, on_lon, duration_seconds, moving_seconds, idle_seconds,
            distance_km, max_speed_kph, start_odometer_km, end_odometer_km, position_count
     FROM fleet_vehicle_trips
     WHERE vehicle_id = $1 AND close_reason = 'open'
     ORDER BY ignition_on_at DESC
     LIMIT 1`,
    [vehicleId],
  );
  if (!row) return null;
  return {
    ignitionOnAt: iso(row.ignition_on_at),
    ignitionOffAt: null,
    closeReason: 'open',
    onLat: num(row.on_lat),
    onLon: num(row.on_lon),
    offLat: null,
    offLon: null,
    durationSeconds: Number(row.duration_seconds ?? 0),
    movingSeconds: Number(row.moving_seconds ?? 0),
    idleSeconds: Number(row.idle_seconds ?? 0),
    distanceKm: Number(row.distance_km ?? 0),
    maxSpeedKph: num(row.max_speed_kph),
    startOdometerKm: num(row.start_odometer_km),
    endOdometerKm: num(row.end_odometer_km),
    positionCount: row.position_count,
  };
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
