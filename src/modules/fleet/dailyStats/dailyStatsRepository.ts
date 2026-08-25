/**
 * Persistence for the vehicle-day stats build.
 *
 * ## The window is REPLACED, never accumulated
 *
 * `upsertDayStats` is `INSERT ... ON CONFLICT (vehicle_id, work_date) DO UPDATE SET <every metric
 * column> = EXCLUDED.<column>`. A vehicle-day row is a function of the positions in that day and
 * nothing else, so re-folding it must overwrite it whole. `DO NOTHING` would freeze whichever
 * partial day happened to be computed first -- and the first computation of TODAY is always
 * partial, so the frozen row would be the normal case rather than the exception.
 *
 * ## Paging is exclusive on the FIX, not merely on the instant
 *
 * `dayFold` refuses the same fix twice (see its header): an inclusive read bound re-feeds the
 * boundary fix, inflating `position_count` and contributing a phantom zero-length interval. So the
 * cursor here is exclusive.
 *
 * It compares the pair `(recorded_at, id)` rather than `recorded_at` alone, and that is a
 * deliberate strengthening of the contract PR1 stated as `recorded_at > watermark`. A bare
 * `recorded_at >` is exclusive but LOSSY on this data: 164 (vehicle, recorded_at) groups over 7
 * days of production hold more than one row, on all seven cartrack/velocity vehicles. When a page
 * boundary falls between two fixes sharing an instant, `recorded_at >` silently drops the second
 * one and `recorded_at >=` re-feeds the first. The pair does neither -- it is exclusive on the
 * fix, which is what the contract was protecting, and it never skips a genuine twin.
 *
 * ## No conditional SQL fragments
 *
 * Interpolated tagged-template conditionals are broken in this repo and silently produce a
 * malformed query, so every optional predicate below is a whole separate statement. Pinned by
 * sqlLiterals.test.ts.
 */
import { query, queryOne } from '@/lib/db-pool';
import {
  POSITIONS_AFTER_CURSOR, POSITIONS_ALL, POSITIONS_FROM_WINDOW, POSITION_BEFORE, TRIPS_ALL,
  TRIPS_FROM_WINDOW, UPSERT_SQL,
} from './dailyStatsSql';
import type { DayPosition, DayTrip, VehicleDayStats } from './types';

/**
 * How far before the watermark a run reconsiders, to catch positions that arrived late.
 *
 * Trackers buffer while out of coverage and flush later, so a fix with an OLDER `recorded_at` can
 * land after the watermark has already moved past it. Six hours matches the trips builder, for the
 * same feeds.
 *
 * NOTE this is only a FLOOR, and the build service never applies it directly: it snaps the result
 * DOWN to a SAST day boundary first. A window that opened mid-day would fold a partial day and
 * write it over a complete one, which is the vehicle-day analogue of the trip-boundary anchor.
 */
export const LATE_ARRIVAL_LOOKBACK_MINUTES = 6 * 60;

/** The last fix a page returned, identifying it exactly. */
export interface PositionCursor {
  recordedAt: string;
  id: string;
}

/** A position as the fold reads it, plus the identity the pager needs. */
export type LoadedPosition = DayPosition & { id: string };

interface PositionRow extends Record<string, unknown> {
  id: string;
  recorded_at: string | Date;
  provider_event_id: string | null;
  provider: string | null;
  account_ref: string | null;
  ignition: boolean | null;
  lat: string | number | null;
  lon: string | number | null;
  speed_kph: string | number | null;
  is_speeding: boolean | null;
  odometer_km: string | number | null;
  linear_g: string | number | null;
  lateral_g: string | number | null;
  provider_event_type: string | null;
}

/** node-postgres returns NUMERIC as a string to avoid precision loss; the fold needs numbers. */
function num(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toPosition(r: PositionRow): LoadedPosition {
  return {
    id: r.id,
    recordedAt: iso(r.recorded_at),
    providerEventId: r.provider_event_id,
    provider: r.provider,
    accountRef: r.account_ref,
    ignition: r.ignition,
    lat: num(r.lat),
    lon: num(r.lon),
    speedKph: num(r.speed_kph),
    isSpeeding: r.is_speeding,
    odometerKm: num(r.odometer_km),
    linearG: num(r.linear_g),
    lateralG: num(r.lateral_g),
    providerEventType: r.provider_event_type,
  };
}

/** Vehicles worth folding: those the position stream has ever mentioned. */
export async function listVehiclesWithPositions(): Promise<string[]> {
  const rows = await query<{ vehicle_id: string }>(
    `/* fleet-daily-stats:vehicles */
     SELECT DISTINCT vehicle_id
     FROM fleet_vehicle_positions
     WHERE vehicle_id IS NOT NULL
     ORDER BY vehicle_id`,
    [],
  );
  return rows.map((r) => r.vehicle_id);
}

/** The newest position already folded into a stats row, or null if this vehicle is untouched. */
export async function readWatermark(vehicleId: string): Promise<string | null> {
  const row = await queryOne<{ last_position_at: string | Date | null }>(
    `/* fleet-daily-stats:watermark-read */
     SELECT last_position_at FROM fleet_daily_stats_watermarks WHERE vehicle_id = $1`,
    [vehicleId],
  );
  return row?.last_position_at ? iso(row.last_position_at) : null;
}

/**
 * Advances the watermark. GREATEST so a re-run over an older window cannot rewind it.
 *
 * The caller writes this only AFTER the day rows it covers are persisted. Reversed, a crash
 * between the two would leave the watermark vouching for rows that do not exist, and the lookback
 * is finite so the gap would never be repaired.
 */
export async function writeWatermark(
  vehicleId: string, lastPositionAt: string, processed: number,
): Promise<void> {
  await query(
    `/* fleet-daily-stats:watermark-write */
     INSERT INTO fleet_daily_stats_watermarks (vehicle_id, last_position_at, positions_processed)
     VALUES ($1, $2::timestamptz, $3)
     ON CONFLICT (vehicle_id) DO UPDATE
       -- GREATEST, so a run over an older window can never rewind the mark.
       SET last_position_at = GREATEST(
             fleet_daily_stats_watermarks.last_position_at, EXCLUDED.last_position_at),
           last_built_at = now(),
           positions_processed = fleet_daily_stats_watermarks.positions_processed
                                 + EXCLUDED.positions_processed`,
    [vehicleId, lastPositionAt, processed],
  );
}

/**
 * One page of a vehicle's positions.
 *
 * `windowStart` opens the window and is INCLUSIVE, because the build service has already snapped
 * it to a SAST midnight and a fix recorded exactly at midnight belongs to the day it opens.
 * `after` pages within that window and is EXCLUSIVE, because the fold refuses a repeated fix.
 * The cursor subsumes the window bound -- it can only ever point at a fix inside it.
 */
export async function loadPositionsForWindow(
  vehicleId: string, windowStart: string | null, after: PositionCursor | null, limit: number,
): Promise<LoadedPosition[]> {
  if (after !== null) {
    const rows = await query<PositionRow>(POSITIONS_AFTER_CURSOR, [vehicleId, after.recordedAt, after.id, limit]);
    return rows.map(toPosition);
  }
  if (windowStart !== null) {
    const rows = await query<PositionRow>(POSITIONS_FROM_WINDOW, [vehicleId, windowStart, limit]);
    return rows.map(toPosition);
  }
  const rows = await query<PositionRow>(POSITIONS_ALL, [vehicleId, limit]);
  return rows.map(toPosition);
}

/**
 * The last fix strictly BEFORE the window opens, or null if the window opens at the stream's head.
 *
 * Without it a vehicle-day's first interval depends on how far back the run happened to start:
 * open at the day's own midnight and the silence spanning midnight is never folded, so the day
 * reports no leading gap, keeps its claim to complete coverage, and loses the distance the
 * closing fix should have carried. Open a day earlier and the same date folds differently. The
 * row would then be a function of the watermark rather than of the vehicle -- the exact defect
 * the batch sweep exists to rule out, arriving through the window instead of through the batch.
 *
 * Folded but never WRITTEN: it belongs to a day the window does not cover, and its own row is
 * already stored complete.
 */
export async function loadPositionBefore(
  vehicleId: string, windowStart: string,
): Promise<LoadedPosition | null> {
  const rows = await query<PositionRow>(POSITION_BEFORE, [vehicleId, windowStart]);
  return rows.length === 0 ? null : toPosition(rows[0]!);
}

/**
 * Closed trips overlapping the window.
 *
 * Only closed ones: an open trip has no bounded ignition period, so it contributes nothing the
 * fold could attribute. Filtered on `ignition_off_at` rather than on the start, so a journey that
 * began before the window but ended inside it still contributes its share.
 */
export async function loadTripsForWindow(
  vehicleId: string, windowStart: string | null,
): Promise<DayTrip[]> {
  const rows = windowStart === null
    ? await query<{ ignition_on_at: string | Date; ignition_off_at: string | Date | null }>(TRIPS_ALL, [vehicleId])
    : await query<{ ignition_on_at: string | Date; ignition_off_at: string | Date | null }>(
      TRIPS_FROM_WINDOW, [vehicleId, windowStart],
    );
  return rows.map((r) => ({
    ignitionOnAt: iso(r.ignition_on_at),
    ignitionOffAt: r.ignition_off_at === null ? null : iso(r.ignition_off_at),
  }));
}

/**
 * Writes one vehicle-day, replacing whatever was there.
 *
 * Every metric column is assigned from EXCLUDED. A column left out of the SET list would keep the
 * value of whichever earlier, partial fold happened to insert the row -- a stale number sitting
 * beside fresh ones in the same row, which no constraint can catch.
 */

export async function upsertDayStats(vehicleId: string, day: VehicleDayStats): Promise<void> {
  await query(UPSERT_SQL, [
    vehicleId, day.workDate, day.ignitionSeconds, day.movingSeconds, day.idleSeconds,
    day.distanceKm, day.maxSpeedKph, day.speedingEvents, day.speedingSeconds,
    day.harshBrakeEvents, day.harshAccelEvents, day.harshCornerEvents,
    day.firstIgnitionAt, day.lastIgnitionAt, day.positionCount, day.trackerSilenceSeconds,
    day.provider, day.accountRef, day.coverageGranularity, day.coverageIgnition,
    day.coverageGforce, day.coverageProviderEvents, day.coverageComplete, day.sourceWatermark,
  ]);
}
