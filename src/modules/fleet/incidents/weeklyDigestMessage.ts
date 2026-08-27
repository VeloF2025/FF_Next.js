/**
 * The Monday weekly digest's message body.
 *
 * Pure: it takes the week's already-loaded totals and returns text, so every honesty rule below
 * is testable over fixtures with no database anywhere near it.
 *
 * ## The one rule this file exists to enforce: never render an unmeasurable quantity as 0
 *
 * Migration 528's `coverage_*` flags mean a vehicle-day can be present and still be unable to
 * answer a question. Ignition hours on a feed too coarse to measure them are UNKNOWN, not zero;
 * harsh-event counts on a day whose feed reported neither g-force nor provider events are
 * UNKNOWN, not zero. A digest that prints `0.0 h` or `0 harsh events` for those turns "we cannot
 * see" into "nothing happened", and the whole point of the coverage flags is that those are
 * different claims. So the unmeasurable case is OMITTED and named, never zeroed:
 *
 *   - a vehicle with no ignition-measurable day shows its distance and says the ignition time is
 *     not measurable, rather than showing `0.0 h`;
 *   - a vehicle that measured ignition on SOME of its reporting days names that denominator, so
 *     four days of hours are never read as a seven-day total;
 *   - a vehicle with no harsh-measurable day is not eligible for the harsh list at all, and when
 *     no vehicle in the fleet had one the section says so instead of listing zeros.
 *
 * ## Contents, and what deliberately is not in them
 *
 * Registrations are the only vehicle identity and there is no driver, no coordinate and no raw
 * telematics — the same restraint `incidentGroupDelivery` and the daily vehicle summary observe,
 * for the same reason: the Fleet Alerts group is a wider and unmanaged audience.
 */
import { INCIDENT_TYPE_LABELS } from './web/incidentLabels';
import { WEEKLY_DIGEST_INCIDENT_TYPES } from './weeklyDigestQueries';
import type { WeeklyVehicleTotals } from './weeklyDigestQueries';
import type { IncidentType } from './types';

const TOP_N = 3;
const SECONDS_PER_HOUR = 3600;

export interface WeeklyDigestInput {
  /** Monday of the week summarised, `YYYY-MM-DD` SAST. */
  weekStart: string;
  /** Sunday of the week summarised — the INCLUSIVE last day, for humans. The query's bound is the Monday after it. */
  weekEnd: string;
  vehicles: readonly WeeklyVehicleTotals[];
  incidentCounts: ReadonlyMap<IncidentType, number>;
}

function km(value: number): string {
  return `${value.toFixed(1)} km`;
}

function hours(seconds: number): string {
  return `${(seconds / SECONDS_PER_HOUR).toFixed(1)} h`;
}

function digestUrl(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app'}/fleet/daily-stats`;
}

/**
 * Coverage is not all-or-nothing across a week: a vehicle can measure ignition on four days and
 * not on the other three, and reporting the four days' hours unqualified beside a seven-day
 * distance silently understates the running time. Three states, therefore, not two — no
 * measurable day (say so), some (name the denominator, as the harsh line does), all (plain).
 */
function distanceLine(vehicle: WeeklyVehicleTotals): string {
  const head = `• ${vehicle.registration}: ${km(vehicle.distanceKm)}`;
  if (vehicle.ignitionDays === 0) return `${head} (ignition time not measurable this week)`;
  if (vehicle.ignitionDays < vehicle.reportingDays) {
    return `${head}, ${hours(vehicle.ignitionSeconds)} ignition over ${vehicle.ignitionDays} of ${vehicle.reportingDays} measured days`;
  }
  return `${head}, ${hours(vehicle.ignitionSeconds)} ignition`;
}

/** Distance survives `coverage_ignition = false`, so it is ranked over every reporting vehicle; ignition time is only shown for the ones that could measure it. */
function topByDistance(vehicles: readonly WeeklyVehicleTotals[]): string[] {
  const ranked = vehicles
    .filter((vehicle) => vehicle.distanceKm > 0)
    .sort((a, b) => b.distanceKm - a.distanceKm || a.registration.localeCompare(b.registration))
    .slice(0, TOP_N);
  if (ranked.length === 0) return ['• no distance recorded this week'];
  return ranked.map(distanceLine);
}

/**
 * Only vehicles with at least one harsh-measurable day are eligible — including the ones whose
 * measured count is 0, which is a real zero and rankable. A vehicle with `harshDays === 0` is not
 * "safest this week", it is unobserved, and it must not appear here at any position.
 */
function topByHarshEvents(vehicles: readonly WeeklyVehicleTotals[]): string[] {
  const measurable = vehicles.filter((vehicle) => vehicle.harshDays > 0);
  if (measurable.length === 0) {
    return ['• not measurable this week — no vehicle-day reported g-force or provider events'];
  }
  const ranked = measurable
    .filter((vehicle) => vehicle.harshEvents > 0)
    .sort((a, b) => b.harshEvents - a.harshEvents || a.registration.localeCompare(b.registration))
    .slice(0, TOP_N);
  if (ranked.length === 0) return [`• none recorded across ${measurable.length} vehicles with usable coverage`];
  return ranked.map((vehicle) => `• ${vehicle.registration}: ${vehicle.harshEvents} over ${vehicle.harshDays} measured days`);
}

/** Every registration, not a top 3: a silent tracker is the one thing the fleet team must chase, and a truncated list hides the rest. */
function silentVehicles(vehicles: readonly WeeklyVehicleTotals[]): string[] {
  const silent = vehicles.filter((vehicle) => vehicle.reportingDays === 0);
  if (silent.length === 0) return ['• none — every tracked vehicle reported at least one day'];
  return silent.map((vehicle) => `• ${vehicle.registration}`);
}

function incidentLine(counts: ReadonlyMap<IncidentType, number>): string {
  return WEEKLY_DIGEST_INCIDENT_TYPES
    .map((type) => `${INCIDENT_TYPE_LABELS[type]}: ${counts.get(type) ?? 0}`)
    .join(' · ');
}

export function buildWeeklyDigestMessage(input: WeeklyDigestInput): string {
  const reporting = input.vehicles.filter((vehicle) => vehicle.reportingDays > 0).length;
  const totalKm = input.vehicles.reduce((sum, vehicle) => sum + vehicle.distanceKm, 0);

  return [
    `📊 *Fleet weekly digest — ${input.weekStart} to ${input.weekEnd} (SAST)*`,
    `Distance: ${km(totalKm)} across ${reporting} of ${input.vehicles.length} tracked vehicles reporting`,
    incidentLine(input.incidentCounts),
    '',
    'Top distance:',
    ...topByDistance(input.vehicles),
    '',
    'Top harsh events:',
    ...topByHarshEvents(input.vehicles),
    '',
    'No data all week (tracker silence):',
    ...silentVehicles(input.vehicles),
    '',
    `details: ${digestUrl()}`,
  ].join('\n');
}
