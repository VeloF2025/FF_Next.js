/**
 * The read path over `fleet_vehicle_daily_stats`.
 *
 * Three questions, one module: the last N SAST days for one vehicle, when that vehicle was first
 * observed at all, and every tracked vehicle's row for a single SAST day.
 *
 * ## Every date here is a SAST calendar date
 *
 * `work_date` is a DATE column, and node-postgres parses DATE (OID 1082) into a JS `Date` at
 * LOCAL midnight. `toISOString().slice(0, 10)` on that answers a South African question in UTC
 * and reports the 1st as the last day of the previous month on any positive-offset host. So the
 * column is read through `toWorkDate`, which takes the calendar parts directly, and the window
 * itself is built from `sastDay`/`dayStartMs` rather than from the host clock's own idea of a day
 * — a server running in UTC would otherwise put every fix between 22:00 and midnight SAST on the
 * wrong day of the window.
 *
 * ## A missing row is not a zero row
 *
 * The series returns only the days that exist. A day the build never produced means "never
 * observed", and the difference between that and a day of zeros — a vehicle that genuinely stood
 * still — is exactly what migration 528's coverage flags exist to preserve. Filling the gaps here
 * would erase it before the caller ever saw it, so the gap-filling belongs to the renderer, which
 * has a distinct state for it.
 */
import { query, queryOne } from '@/lib/db-pool';
import { toWorkDate } from '../incidents/analytics/sastDates';
import { MS_PER_DAY, dayStartMs, sastDay } from './dayIntervals';
import type { CoverageGranularity, VehicleDayStats } from './types';

/** The longest window the read path will serve. Bounds one query, not a product decision. */
export const MAX_WINDOW_DAYS = 90;
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * One stored vehicle-day, as the API returns it.
 *
 * `unattributed_seconds` is deliberately NOT selected. It is a GENERATED column and a
 * cartrack/velocity-only residual — a feed too coarse to measure ignition fails
 * `coverage_ignition` and stores 0 there — so on the feeds where a reader would most want an
 * explanation for near-zero moving time it says nothing. `tracker_silence_seconds` is the number
 * that actually explains those days, and it is rendered.
 */
export interface VehicleDayStatsRow extends VehicleDayStats {
  computedAt: string;
}

export interface StatsWindow {
  startWorkDate: string;
  endWorkDate: string;
  days: number;
}

/** Today's SAST calendar date, whatever zone the host runs in. */
export function sastToday(nowMs: number = Date.now()): string {
  return sastDay(nowMs);
}

/** Yesterday in SAST — the newest day whose fold has seen a full 24 hours. */
export function sastYesterday(nowMs: number = Date.now()): string {
  return sastDay(dayStartMs(sastDay(nowMs)) - MS_PER_DAY);
}

/**
 * The `days`-long window ending on `endWorkDate`, inclusive of both ends.
 *
 * Built by stepping back whole SAST days from that date's own midnight, so the arithmetic never
 * passes through the host's local calendar.
 */
export function statsWindow(endWorkDate: string, days: number): StatsWindow {
  const clamped = Math.min(Math.max(Math.trunc(days), 1), MAX_WINDOW_DAYS);
  const startWorkDate = sastDay(dayStartMs(endWorkDate) - (clamped - 1) * MS_PER_DAY);
  return { startWorkDate, endWorkDate, days: clamped };
}

/** Whole SAST days from `from` to `to`, inclusive — the denominator of a coverage ratio. */
export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((dayStartMs(to) - dayStartMs(from)) / MS_PER_DAY) + 1;
}

interface StatsRow extends Record<string, unknown> {
  work_date: string | Date;
  ignition_seconds: string | null;
  moving_seconds: string | null;
  idle_seconds: string | null;
  distance_km: string | null;
  max_speed_kph: string | null;
  speeding_events: string | null;
  speeding_seconds: string | null;
  harsh_brake_events: string | null;
  harsh_accel_events: string | null;
  harsh_corner_events: string | null;
  first_ignition_at: string | Date | null;
  last_ignition_at: string | Date | null;
  position_count: string | null;
  tracker_silence_seconds: string | null;
  provider: string | null;
  account_ref: string | null;
  coverage_granularity: string;
  coverage_ignition: boolean;
  coverage_gforce: boolean;
  coverage_provider_events: boolean;
  coverage_complete: boolean;
  source_watermark: string | Date | null;
  computed_at: string | Date;
}

/**
 * node-postgres returns BIGINT and NUMERIC as strings to avoid precision loss.
 *
 * `Number` rather than `parseInt`: `distance_km` is NUMERIC(10,2) and parsing it as an integer
 * would silently drop the decimal part of every day's distance.
 */
function num(value: string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const STATS_COLUMNS = `
  work_date, ignition_seconds, moving_seconds, idle_seconds, distance_km, max_speed_kph, speeding_events, speeding_seconds,
  harsh_brake_events, harsh_accel_events, harsh_corner_events,
  first_ignition_at, last_ignition_at, position_count, tracker_silence_seconds,
  provider, account_ref, coverage_granularity, coverage_ignition, coverage_gforce,
  coverage_provider_events, coverage_complete, source_watermark, computed_at`;

function mapRow(row: StatsRow): VehicleDayStatsRow {
  return {
    workDate: toWorkDate(row.work_date),
    ignitionSeconds: num(row.ignition_seconds),
    movingSeconds: num(row.moving_seconds),
    idleSeconds: num(row.idle_seconds),
    distanceKm: num(row.distance_km),
    maxSpeedKph: nullableNum(row.max_speed_kph),
    speedingEvents: num(row.speeding_events),
    speedingSeconds: num(row.speeding_seconds),
    harshBrakeEvents: num(row.harsh_brake_events),
    harshAccelEvents: num(row.harsh_accel_events),
    harshCornerEvents: num(row.harsh_corner_events),
    firstIgnitionAt: iso(row.first_ignition_at),
    lastIgnitionAt: iso(row.last_ignition_at),
    positionCount: num(row.position_count),
    trackerSilenceSeconds: num(row.tracker_silence_seconds),
    provider: row.provider,
    accountRef: row.account_ref,
    coverageGranularity: row.coverage_granularity as CoverageGranularity,
    coverageIgnition: row.coverage_ignition,
    coverageGforce: row.coverage_gforce,
    coverageProviderEvents: row.coverage_provider_events,
    coverageComplete: row.coverage_complete,
    sourceWatermark: iso(row.source_watermark),
    computedAt: iso(row.computed_at) ?? '',
  };
}

/** The days that EXIST in `window`, oldest first. Absent days are absent, never zeroed. */
export async function loadVehicleDayStats(
  vehicleId: string, window: StatsWindow,
): Promise<VehicleDayStatsRow[]> {
  const rows = await query<StatsRow>(
    `/* fleet-daily-stats:series */
     SELECT ${STATS_COLUMNS}
     FROM fleet_vehicle_daily_stats
     WHERE vehicle_id = $1
       AND work_date >= $2::date
       AND work_date <= $3::date
     ORDER BY work_date`,
    [vehicleId, window.startWorkDate, window.endWorkDate],
  );
  return rows.map(mapRow);
}

/**
 * The SAST day this vehicle was first seen on, or null if it never has been.
 *
 * The denominator of "days with data / days expected": a vehicle whose tracker was fitted last
 * week has not missed the three weeks before that, and charging them against it would report a
 * healthy feed as broken.
 */
export async function loadFirstPositionWorkDate(vehicleId: string): Promise<string | null> {
  const row = await queryOne<{ first_at: string | Date | null }>(
    `/* fleet-daily-stats:first-position */
     SELECT min(recorded_at) AS first_at
     FROM fleet_vehicle_positions
     WHERE vehicle_id = $1`,
    [vehicleId],
  );
  if (!row?.first_at) return null;
  const at = row.first_at instanceof Date ? row.first_at.getTime() : Date.parse(row.first_at);
  return Number.isFinite(at) ? sastDay(at) : null;
}

export interface VehicleIdentity {
  vehicleId: string;
  registration: string | null;
  make: string | null;
  model: string | null;
  status: string | null;
}

/** The vehicle, or null. A null here is the API's 404 — never an empty stats page. */
export async function loadVehicleIdentity(vehicleId: string): Promise<VehicleIdentity | null> {
  const row = await queryOne<{
    id: string; registration: string | null; make: string | null;
    model: string | null; status: string | null;
  }>(
    `/* fleet-daily-stats:vehicle */
     SELECT id, registration, make, model, status FROM fleet_vehicles WHERE id = $1`,
    [vehicleId],
  );
  if (!row) return null;
  return {
    vehicleId: row.id, registration: row.registration,
    make: row.make, model: row.model, status: row.status,
  };
}

export interface FleetOverviewRow extends VehicleIdentity {
  /** Null means this vehicle produced no row for the day: never observed, not a still day. */
  stats: VehicleDayStatsRow | null;
}

/**
 * Every active vehicle that carries a tracker, with its row for `workDate` if one exists.
 *
 * A LEFT JOIN rather than an inner one on purpose: a tracked vehicle with no row for the day is
 * the most interesting line in the table, and an inner join would silently drop it.
 */
export async function loadFleetDayOverview(workDate: string): Promise<FleetOverviewRow[]> {
  const rows = await query<StatsRow & {
    id: string; registration: string | null; make: string | null;
    model: string | null; status: string | null; has_stats: boolean;
  }>(
    `/* fleet-daily-stats:overview */
     SELECT v.id, v.registration, v.make, v.model, v.status,
            (s.vehicle_id IS NOT NULL) AS has_stats,
            ${STATS_COLUMNS.split(',').map((c) => `s.${c.trim()}`).join(', ')}
     FROM fleet_vehicles v
     JOIN fleet_vehicle_trackers tr ON tr.vehicle_id = v.id AND tr.is_active
     LEFT JOIN fleet_vehicle_daily_stats s
            ON s.vehicle_id = v.id AND s.work_date = $1::date
     WHERE v.status = 'active'
     ORDER BY v.registration`,
    [workDate],
  );
  return rows.map((row) => ({
    vehicleId: row.id,
    registration: row.registration,
    make: row.make,
    model: row.model,
    status: row.status,
    stats: row.has_stats ? mapRow(row) : null,
  }));
}
