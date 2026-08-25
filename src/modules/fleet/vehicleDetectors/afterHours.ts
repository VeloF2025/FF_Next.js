/**
 * Is an instant "after hours" for the fleet?
 *
 * PURE — no database, no clock, no environment. Everything it needs arrives as
 * an argument, which is what lets the tests run identically under
 * TZ=Africa/Johannesburg and TZ=UTC.
 *
 * The trap this file exists to contain: the seeded window is 18:00 → 06:00,
 * which **wraps midnight**. The obvious comparison —
 *
 *     start <= time && time < end        // 18:00 <= t && t < 06:00
 *
 * is false for every instant of every day, so a detector gated on it never
 * fires and looks merely quiet rather than broken. A wrapping window is the
 * UNION of two spans (`t >= start` OR `t < end`), not an interval.
 *
 * Everything is evaluated in the rule's own timezone via `Intl`, never through
 * `toISOString()`: 22:30 UTC is already tomorrow in Johannesburg, so a UTC read
 * lands a Friday-night instant on Saturday's weekend rule (or misses it).
 */

import type { VehicleOperationalRule } from './types';

/** Weekend days as `Intl` reports them for `en-CA` with `weekday: 'short'`. */
const WEEKEND_DAYS = new Set(['Sat', 'Sun']);

interface ZonedParts {
  /** `YYYY-MM-DD` in the rule's zone — the key a holiday set is built on. */
  date: string;
  /** Seconds since local midnight. */
  secondsOfDay: number;
  weekday: string;
}

/** Seconds since midnight for a `HH:MM` or `HH:MM:SS` clock time. */
export function secondsOfDay(clockTime: string): number {
  const parts = clockTime.split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] ?? '0');
  const seconds = Number(parts[2] ?? '0');
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    throw new Error(`Not a clock time: ${clockTime}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function zonedParts(instantIso: string, timeZone: string): ZonedParts {
  const at = new Date(instantIso);
  if (Number.isNaN(at.getTime())) throw new Error(`Not an instant: ${instantIso}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  // Intl renders midnight as hour "24" under hour12:false in some ICU builds.
  const hour = value('hour') === '24' ? '00' : value('hour');
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    secondsOfDay: secondsOfDay(`${hour}:${value('minute')}:${value('second')}`),
    weekday: value('weekday'),
  };
}

/**
 * True when `instantIso` falls inside the rule's after-hours window, on a
 * weekend the rule counts, or on a public holiday the rule counts.
 *
 * `holidays` is a set of `YYYY-MM-DD` dates in the rule's timezone — build it
 * with `loadHolidays` from `holidayQueries.ts`, which reads the real
 * `public_holidays` table rather than a hand-written list.
 */
export function isAfterHours(
  instantIso: string,
  rule: VehicleOperationalRule,
  holidays: ReadonlySet<string>,
): boolean {
  const at = zonedParts(instantIso, rule.timezone);
  if (rule.weekendsAreAfterHours && WEEKEND_DAYS.has(at.weekday)) return true;
  if (rule.publicHolidaysAreAfterHours && holidays.has(at.date)) return true;

  const start = secondsOfDay(rule.afterHoursStartTime);
  const end = secondsOfDay(rule.afterHoursEndTime);
  // Equal boundaries describe a window that never closes, not one of zero width:
  // an operator who sets 00:00 → 00:00 means "always", and the alternative
  // reading silently disables every after-hours detector.
  if (start === end) return true;
  if (start < end) return at.secondsOfDay >= start && at.secondsOfDay < end;
  return at.secondsOfDay >= start || at.secondsOfDay < end;
}
