/**
 * The two reads behind the Monday weekly fleet digest.
 *
 * ## Every window here is half-open, and anchored on SAST midnights
 *
 * A week is `[Monday 00:00 SAST, the next Monday 00:00 SAST)`. An inclusive upper bound would
 * put the Monday the digest is SENT ON into the week it summarises, and every one of that
 * Monday's incidents would then be counted twice — once here and once in next week's digest.
 * The `<` in both statements is therefore load-bearing, not a style choice, and a test pins the
 * statement text.
 *
 * ## Coverage decides what may be counted, never how it is rendered
 *
 * Migration 528's `coverage_*` flags state what a vehicle-day's feed could actually observe.
 * `harsh_*_events` on a day that reported neither g-force nor provider events is not "no harsh
 * events" — it is "nothing could have been detected", and summing it into a weekly count would
 * publish a zero the data never supported. So the aggregates below sum harsh counts only over
 * measurable days and report the measurable-day count beside them; the caller renders the
 * distinction, and never renders an unmeasurable quantity as 0.
 *
 * Distance is deliberately NOT gated: `distance_km` accrues from odometer/position deltas and
 * survives `coverage_ignition = false`, which is exactly why a coarse feed can still say how far
 * a vehicle went while being unable to say for how long it ran.
 */
import { query } from '@/lib/db-pool';
import type { IncidentType } from './types';

/** The vehicle-level incident types the digest counts, in the order the message renders them. */
export const WEEKLY_DIGEST_INCIDENT_TYPES: readonly IncidentType[] = [
  'theft_after_hours_movement', 'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving',
] as const;

/** One active, tracked vehicle's week. Every count is already restricted to the days that could measure it. */
export interface WeeklyVehicleTotals {
  vehicleId: string;
  registration: string;
  /** Days in the window that produced a `fleet_vehicle_daily_stats` row at all. Zero means tracker silence for the whole week. */
  reportingDays: number;
  distanceKm: number;
  /** Days whose feed could measure ignition time. Zero means the hours below are unknowable, NOT zero. */
  ignitionDays: number;
  ignitionSeconds: number;
  /** Days whose feed could detect a harsh event (g-force or provider events). Zero means the count below is unknowable, NOT zero. */
  harshDays: number;
  harshEvents: number;
}

interface VehicleRow extends Record<string, unknown> {
  vehicle_id: string; registration: string; reporting_days: number;
  distance_km: string | null; ignition_days: number; ignition_seconds: string | null;
  harsh_days: number; harsh_events: number;
}

/** node-postgres returns NUMERIC and BIGINT as strings; `Number` keeps the decimal part of `distance_km`. */
function num(value: string | number | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Every active vehicle carrying an active tracker, with its week folded up.
 *
 * `EXISTS` rather than the `JOIN fleet_vehicle_trackers` that `statsQueries.loadFleetDayOverview`
 * uses: that join is safe for a single day's LEFT JOIN row, but here it would fan a vehicle with
 * two active trackers into two joined rows and DOUBLE its weekly distance. A digest that
 * overstates the fleet's kilometres is worse than one that is a query slower.
 *
 * The LEFT JOIN is what makes the zero-reporting list possible: a vehicle with no row all week is
 * the most important line in the message, and an inner join would drop it silently.
 */
export async function loadWeeklyVehicleTotals(
  weekStart: string, weekEndExclusive: string,
): Promise<WeeklyVehicleTotals[]> {
  const rows = await query<VehicleRow>(
    `/* fleet-weekly-digest:vehicle-totals */
     SELECT v.id AS vehicle_id,
       COALESCE(NULLIF(btrim(v.registration), ''), 'Unregistered') AS registration,
       COUNT(s.work_date)::int AS reporting_days,
       COALESCE(SUM(s.distance_km), 0) AS distance_km,
       COUNT(*) FILTER (WHERE s.coverage_ignition)::int AS ignition_days,
       COALESCE(SUM(s.ignition_seconds) FILTER (WHERE s.coverage_ignition), 0) AS ignition_seconds,
       COUNT(*) FILTER (WHERE s.coverage_gforce OR s.coverage_provider_events)::int AS harsh_days,
       COALESCE(SUM(s.harsh_brake_events + s.harsh_accel_events + s.harsh_corner_events)
                FILTER (WHERE s.coverage_gforce OR s.coverage_provider_events), 0)::int AS harsh_events
     FROM fleet_vehicles v
     LEFT JOIN fleet_vehicle_daily_stats s
            ON s.vehicle_id = v.id
           AND s.work_date >= $1::date
           AND s.work_date < $2::date
     WHERE v.status = 'active'
       AND EXISTS (SELECT 1 FROM fleet_vehicle_trackers tr WHERE tr.vehicle_id = v.id AND tr.is_active)
     GROUP BY v.id, v.registration
     ORDER BY v.registration`,
    [weekStart, weekEndExclusive],
  );
  return rows.map((row) => ({
    vehicleId: row.vehicle_id,
    registration: row.registration,
    reportingDays: Number(row.reporting_days),
    distanceKm: num(row.distance_km),
    ignitionDays: Number(row.ignition_days),
    ignitionSeconds: num(row.ignition_seconds),
    harshDays: Number(row.harsh_days),
    harshEvents: Number(row.harsh_events),
  }));
}

/** Counts for exactly the four types the digest names — a type with no incidents is absent, and the caller renders it as 0. */
export async function loadWeeklyIncidentCounts(
  weekStartIso: string, weekEndIso: string,
): Promise<Map<IncidentType, number>> {
  const rows = await query<{ incident_type: IncidentType; incident_count: number } & Record<string, unknown>>(
    `/* fleet-weekly-digest:incident-counts */
     SELECT incident_type, COUNT(*)::int AS incident_count
     FROM fleet_operational_incidents
     WHERE staff_id IS NULL
       AND incident_type = ANY($1::text[])
       AND detected_at >= $2::timestamptz
       AND detected_at < $3::timestamptz
     GROUP BY incident_type`,
    [[...WEEKLY_DIGEST_INCIDENT_TYPES], weekStartIso, weekEndIso],
  );
  return new Map(rows.map((row) => [row.incident_type, Number(row.incident_count)]));
}
