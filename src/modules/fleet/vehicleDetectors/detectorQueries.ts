/**
 * The reads behind the vehicle detector phase.
 *
 * Positions are read DIRECTLY from `fleet_vehicle_positions`, never from
 * `fleet_vehicle_daily_stats`: the build service that populates that table is a
 * separate, unmerged slice, and a detector that depends on it would go silent
 * whenever that job fell behind — silently, because an empty day and a
 * not-yet-built day look identical.
 *
 * Every optional filter is TWO WHOLE EXPLICIT QUERY BRANCHES. Conditional
 * tagged-template SQL fragments are broken in this repo and silently produce a
 * malformed query; `trips/tripRepository.ts`'s `loadPositions` is the reference
 * shape.
 */

import { query, queryOne } from '@/lib/db-pool';
import type { DetectorPosition, DetectorVehicle } from './types';

const POSITION_COLUMNS = `recorded_at, provider_event_id, provider, account_ref, ignition,
  lat, lon, speed_kph, linear_g, lateral_g, provider_event_type`;

interface PositionRow extends Record<string, unknown> {
  recorded_at: string | Date;
  provider_event_id: string | null;
  provider: string | null;
  account_ref: string | null;
  ignition: boolean | null;
  lat: string | number | null;
  lon: string | number | null;
  speed_kph: string | number | null;
  linear_g: string | number | null;
  lateral_g: string | number | null;
  provider_event_type: string | null;
}

interface VehicleRow extends Record<string, unknown> {
  id: string;
  registration: string | null;
  after_hours_exempt: boolean | null;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** NUMERIC arrives as a string from node-postgres; a non-finite value is not a reading. */
function num(value: string | number | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapPosition(row: PositionRow): DetectorPosition {
  return {
    recordedAt: iso(row.recorded_at),
    providerEventId: row.provider_event_id,
    provider: row.provider,
    accountRef: row.account_ref,
    ignition: row.ignition,
    lat: num(row.lat),
    lon: num(row.lon),
    speedKph: num(row.speed_kph),
    linearG: num(row.linear_g),
    lateralG: num(row.lateral_g),
    providerEventType: row.provider_event_type,
  };
}

/**
 * Every vehicle with an ACTIVE tracker.
 *
 * Not "every vehicle that has positions": a vehicle whose tracker was removed
 * still has history, and running `lost_contact_moving` over it would open an
 * incident for a vehicle nobody expects to hear from ever again.
 */
export async function loadDetectorVehicles(): Promise<DetectorVehicle[]> {
  const rows = await query<VehicleRow>(
    `/* fleet-detectors:vehicles */
     SELECT v.id, v.registration, v.after_hours_exempt
     FROM fleet_vehicles v
     JOIN fleet_vehicle_trackers t ON t.vehicle_id = v.id AND t.is_active
     ORDER BY v.id`,
  );
  return rows.map((row) => ({
    vehicleId: row.id,
    registration: row.registration,
    afterHoursExempt: row.after_hours_exempt === true,
  }));
}

/**
 * The detection window for one vehicle, ascending.
 *
 * `LIMIT` is a ceiling against a backfill dumping a month of history into one
 * tick, not a page size — the newest rows are the ones that matter, so the
 * limit is applied to a descending read and the result is reversed. Taking the
 * OLDEST rows under a limit would pin the detectors to the start of the
 * backfill and they would never see the present.
 */
export async function loadPositionWindow(
  vehicleId: string, from: string, limit: number,
): Promise<DetectorPosition[]> {
  const rows = await query<PositionRow>(
    `/* fleet-detectors:window */
     SELECT ${POSITION_COLUMNS}
     FROM fleet_vehicle_positions
     WHERE vehicle_id = $1 AND recorded_at >= $2::timestamptz
     ORDER BY recorded_at DESC, id DESC
     LIMIT $3`,
    [vehicleId, from, limit],
  );
  return rows.reverse().map(mapPosition);
}

/** The vehicle's newest fix regardless of any window, or null when it has never reported. */
export async function loadLastPosition(vehicleId: string): Promise<DetectorPosition | null> {
  const row = await queryOne<PositionRow>(
    `/* fleet-detectors:last-position */
     SELECT ${POSITION_COLUMNS}
     FROM fleet_vehicle_positions
     WHERE vehicle_id = $1
     ORDER BY recorded_at DESC, id DESC
     LIMIT 1`,
    [vehicleId],
  );
  return row ? mapPosition(row) : null;
}

/**
 * p90 inter-fix gap in seconds over `[since, now]`, or null when fewer than two
 * fixes make a gap.
 *
 * Aggregated in Postgres rather than over loaded rows on purpose: this is the
 * only thing the last 24 hours are needed for, and `cartrack/velocity` reports
 * ~1,169 fixes per vehicle-day. Loading a day of positions for all eighteen
 * vehicles every five minutes to compute one percentile would be ~21k rows a
 * tick, 288 times a day, to produce eighteen numbers.
 */
export async function loadGapP90Seconds(vehicleId: string, since: string): Promise<number | null> {
  const row = await queryOne<{ p90: string | number | null }>(
    `/* fleet-detectors:gap-p90 */
     WITH gaps AS (
       SELECT EXTRACT(EPOCH FROM recorded_at
              - lag(recorded_at) OVER (ORDER BY recorded_at)) AS gap_seconds
       FROM fleet_vehicle_positions
       WHERE vehicle_id = $1 AND recorded_at >= $2::timestamptz
     )
     SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY gap_seconds) AS p90
     FROM gaps WHERE gap_seconds IS NOT NULL`,
    [vehicleId, since],
  );
  return row ? num(row.p90) : null;
}
