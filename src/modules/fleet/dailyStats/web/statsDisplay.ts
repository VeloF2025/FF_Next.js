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
  field: 'ignitionSeconds' | 'movingSeconds' | 'idleSeconds',
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
 * Speeding duration, which shares the fold's attribution ceiling with ignition time.
 *
 * `coverageIgnition === false` disqualifies the DURATION outright, whatever its value. Migration
 * 528's own comment says to read the flag as "do not trust the duration", never as "the duration
 * is zero" — and the worked example there is a non-zero one: an ituran/avis day of ~35-minute
 * gaps stores 60 s beside `coverage_ignition = false` and `ignition_seconds = 0`, because those
 * seconds accrue per interval while the flag judges the day's MEDIAN gap. Rendering that 60 s as
 * "1m" states a measurement the feed cannot support, exactly as a 0 would.
 *
 * The event COUNT is unaffected and still rendered: it comes from rising edges of the provider's
 * own flag, not from the fold's attribution. Note a single day's count does not answer "did this
 * vehicle speed on this date" — a stretch crossing SAST midnight is counted once, on the day it
 * began, so the second day carries seconds with no events.
 */
export function speedingSecondsValue(row: VehicleDayStatsRow | null): StatValue {
  if (row === null) return missing;
  if (!row.coverageIgnition) return unmeasurable;
  return { kind: 'value', text: formatDuration(row.speedingSeconds) };
}

/** Harsh counts need a g reading or a provider event vocabulary; neither means unobservable. */
export function harshValue(row: VehicleDayStatsRow | null, count: number): StatValue {
  if (row === null) return missing;
  if (!row.coverageGforce && !row.coverageProviderEvents) return unmeasurable;
  return { kind: 'value', text: String(count) };
}

/**
 * Why one day's event count does not answer "did this vehicle speed on this date".
 *
 * The rising edge of the provider's `is_speeding` flag is FOLD-GLOBAL, not per-day, so a stretch
 * crossing SAST midnight is counted once — on the day it began — while both days carry the
 * seconds that fell in them. Summing across days is therefore correct; reading a single day's
 * count as "did it speed today" is not. Shared by the card and the overview cell so the two
 * cannot drift into telling a reader different things about the same number.
 */
export const SPEEDING_EVENTS_TITLE =
  'rising edges of the provider’s own speeding flag: counted once per stretch, and a stretch '
  + 'straddling SAST midnight counts on its first day only';

export const NO_IGNITION_OBSERVED = 'no ignition was observed on this day';
export const SILENCE_TITLE =
  'the LARGEST unobserved stretch of the day, including the hours before the first fix and after '
  + 'the last — an observation about the feed, not a measurement of the vehicle';
export const IGNITION_WINDOW_TITLE =
  'observations: a fix asserted ignition at these instants. Not a duration — a two-hour feed can '
  + 'say when the vehicle first moved without being able to say for how long';

/**
 * The largest unobserved stretch of the day.
 *
 * Survives `coverageIgnition === false` because it is not derived from ignition at all: it is the
 * biggest hole in the observation record, and it is largest exactly on the feeds that cannot
 * measure ignition. Suppressing it there would hide the number that explains the em dashes.
 */
export function trackerSilenceValue(row: VehicleDayStatsRow | null): StatValue {
  if (row === null) return missing;
  return { kind: 'value', text: formatDuration(row.trackerSilenceSeconds), title: SILENCE_TITLE };
}

/**
 * First and last ignition as clock times.
 *
 * An OBSERVATION rather than a measurement, so it also survives `coverageIgnition === false` — see
 * migration 528's comment on `first_ignition_at`. Absent instants are an em dash saying no
 * ignition was observed, never 00:00.
 */
export function ignitionWindowValue(row: VehicleDayStatsRow | null): StatValue {
  if (row === null) return missing;
  if (row.firstIgnitionAt === null || row.lastIgnitionAt === null) {
    return { kind: 'unmeasurable', text: UNMEASURABLE_TEXT, title: NO_IGNITION_OBSERVED };
  }
  return {
    kind: 'value',
    text: `${sastClock(row.firstIgnitionAt)}–${sastClock(row.lastIgnitionAt)}`,
    title: IGNITION_WINDOW_TITLE,
  };
}

/** An instant as a SAST wall clock time. The fleet's day is a South African day. */
export function sastClock(at: string): string {
  return new Date(at).toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg',
  });
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
