/**
 * The one place that decides how an unmeasurable number is written down.
 *
 * Migration 528 refuses to STORE a statistic its feed cannot support; this file refuses to RENDER
 * one. Both halves are needed, because the failure mode is a plausible number in the right column:
 *
 *   `coverageIgnition === false` — the feed does not assert ignition often enough, or its median
 *   inter-fix gap is beyond the attribution ceiling. `ignitionSeconds` is then 0 by CHECK
 *   constraint, and printing "0h 0m" claims the vehicle stood still all day. It says nothing of
 *   the sort: nobody could see.
 *
 *   `coverageComplete === false` — the day was observed, but not to its own feed's standard.
 *   That is a third state, not a rounding error, and it never collapses into either of the others.
 *
 *   A missing row — the fold never produced one. Never observed. Not a still day, and above all
 *   not zero.
 *
 * Every helper returns a `StatValue` carrying the reason, so a caller cannot render the text
 * without also having the tooltip that explains it.
 */
import { MS_PER_DAY, dayStartMs, sastDay } from '../dayIntervals';
import type { VehicleDayStatsRow } from '../statsQueries';

export const UNMEASURABLE_TEXT = '—';
export const UNMEASURABLE_TITLE = 'not measurable on this feed';
export const MISSING_TEXT = 'No data';
export const MISSING_TITLE = 'no row was built for this day — the vehicle was never observed';

export interface StatValue {
  kind: 'value' | 'unmeasurable' | 'missing';
  text: string;
  title?: string;
}

const unmeasurable: StatValue = {
  kind: 'unmeasurable', text: UNMEASURABLE_TEXT, title: UNMEASURABLE_TITLE,
};
const missing: StatValue = { kind: 'missing', text: MISSING_TEXT, title: MISSING_TITLE };

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatKm(km: number): string {
  return `${km.toFixed(1)} km`;
}

/** Ignition, moving and idle seconds all stand or fall on the same flag. */
export function ignitionTimeValue(
  row: VehicleDayStatsRow | null,
  field: 'ignitionSeconds' | 'movingSeconds' | 'idleSeconds' | 'unattributedSeconds',
): StatValue {
  if (row === null) return missing;
  if (!row.coverageIgnition) return unmeasurable;
  return { kind: 'value', text: formatDuration(row[field]) };
}

/** Distance and top speed survive `coverageIgnition === false`: they come from other fields. */
export function distanceValue(row: VehicleDayStatsRow | null): StatValue {
  if (row === null) return missing;
  return { kind: 'value', text: formatKm(row.distanceKm) };
}

export function maxSpeedValue(row: VehicleDayStatsRow | null): StatValue {
  if (row === null) return missing;
  if (row.maxSpeedKph === null) return unmeasurable;
  return { kind: 'value', text: `${Math.round(row.maxSpeedKph)} km/h` };
}

/**
 * Speeding duration, which has its own trap in both directions.
 *
 * 0 seconds beside a non-zero event count is a feed too coarse to measure the stretch, not an
 * event of no duration — and `coverageIgnition === false` is the signal for it. The reverse
 * (seconds with no events) is normal on the second day of an overspeed that crossed SAST
 * midnight, since the rising edge is counted once on the day it began.
 */
export function speedingSecondsValue(row: VehicleDayStatsRow | null): StatValue {
  if (row === null) return missing;
  if (row.speedingSeconds === 0 && row.speedingEvents > 0 && !row.coverageIgnition) {
    return unmeasurable;
  }
  return { kind: 'value', text: formatDuration(row.speedingSeconds) };
}

/** Harsh counts need a g reading or a provider event vocabulary; neither means unobservable. */
export function harshValue(row: VehicleDayStatsRow | null, count: number): StatValue {
  if (row === null) return missing;
  if (!row.coverageGforce && !row.coverageProviderEvents) return unmeasurable;
  return { kind: 'value', text: String(count) };
}

export type CoverageState = 'missing' | 'partial' | 'complete';

export function coverageState(row: VehicleDayStatsRow | null): CoverageState {
  if (row === null) return 'missing';
  return row.coverageComplete ? 'complete' : 'partial';
}

export const COVERAGE_LABEL: Record<CoverageState, string> = {
  missing: 'No data',
  partial: 'Partial',
  complete: 'Complete',
};

export const COVERAGE_TITLE: Record<CoverageState, string> = {
  missing: MISSING_TITLE,
  partial: 'observed, but with less evidence than this feed’s own standard requires',
  complete: 'observed to this feed’s own standard for the whole day',
};

/** Tailwind classes for the three states, in both themes. */
export const COVERAGE_CLASS: Record<CoverageState, string> = {
  missing: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  complete: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

/**
 * A total over the days that could actually contribute to it.
 *
 * Returns the count of contributing days beside the number, because a 30-day total built from 4
 * measurable days is a different claim from one built from 30 and must not be printed as though
 * it were the second.
 */
export interface PartialTotal {
  total: number;
  daysCounted: number;
  daysConsidered: number;
}

export function sumOverMeasurableDays(
  rows: VehicleDayStatsRow[],
  field: 'ignitionSeconds' | 'movingSeconds' | 'idleSeconds',
): PartialTotal {
  const measurable = rows.filter((r) => r.coverageIgnition);
  return {
    total: measurable.reduce((acc, r) => acc + r[field], 0),
    daysCounted: measurable.length,
    daysConsidered: rows.length,
  };
}

export function sumDistance(rows: VehicleDayStatsRow[]): PartialTotal {
  return {
    total: rows.reduce((acc, r) => acc + r.distanceKm, 0),
    daysCounted: rows.length,
    daysConsidered: rows.length,
  };
}

/**
 * Every SAST date in the window, so the renderer can show the days that are MISSING.
 *
 * The API returns only the rows that exist, which is the honest answer for a series but not for a
 * table: an absent date has to appear as "no data" rather than not appear at all, or a dead
 * tracker looks like a short month.
 */
export function datesInWindow(startWorkDate: string, endWorkDate: string): string[] {
  const dates: string[] = [];
  let cursor = dayStartMs(startWorkDate);
  const end = dayStartMs(endWorkDate);
  while (cursor <= end) {
    dates.push(sastDay(cursor));
    // Step from the day's own midnight rather than accumulating, so no drift is possible.
    cursor = dayStartMs(sastDay(cursor)) + MS_PER_DAY;
  }
  return dates;
}
