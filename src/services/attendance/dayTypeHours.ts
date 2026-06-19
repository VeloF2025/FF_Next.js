/**
 * Pure day-type splitter for the BCEA overtime engine (#1990 / #2028).
 *
 * Splits a single closed shift across SAST calendar days and tallies the
 * three disjoint quantities the wage layer needs:
 *
 *   - sundayHrs  — hours worked on a Sunday (BCEA s16)
 *   - holidayHrs — hours worked on a public holiday (BCEA s18). Holiday takes
 *                  precedence over Sunday on the same day, so a given
 *                  millisecond belongs to AT MOST one of these two buckets.
 *   - overtimeOnNonPremiumHrs — of the OT tail (hours beyond dailyOrdinaryHrs
 *                  at the chronological END of the shift), how many fall on
 *                  ORDINARY calendar time (neither Sunday nor holiday).
 *
 * Why overtimeOnNonPremiumHrs lives here, not in the wage calculator:
 *   The persisted daily summary only carries bucket TOTALS. From totals alone
 *   you cannot tell a Sat→Sun shift (OT tail lands on the Sunday → premium
 *   absorbs the OT) apart from a Sun→Mon shift (OT tail lands on the ordinary
 *   Monday → OT premium is owed). The two produce identical (sundayHrs,
 *   overtimeHrs) totals but different correct pay. Only the time-ordered split
 *   computed HERE distinguishes them, so we compute it where the clock times
 *   are still in hand and hand it to the wage calculator on the summary.
 *
 * Pure: no DB, no side effects. Holidays arrive pre-loaded as a Set.
 */

import { isSunday } from './saPublicHolidays';

export const MS_PER_HOUR = 3600_000;
export const MS_PER_DAY = 86_400_000;

/** Midnight (SAST) of the calendar day containing `d`. */
export function sastMidnight(d: Date): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const ymd = fmt.format(d);
  return new Date(`${ymd}T00:00:00+02:00`);
}

/** SAST calendar day (YYYY-MM-DD) of the instant `d`. */
export function sastYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Milliseconds of overlap between [aStart,aEnd) and [bStart,bEnd). */
export function overlapMs(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const lo = Math.max(aStart.getTime(), bStart.getTime());
  const hi = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, hi - lo);
}

export interface DayTypeHours {
  sundayHrs: number;
  holidayHrs: number;
  /**
   * Hours of the OT tail (the part of the shift beyond `dailyOrdinaryHrs`)
   * that fall on ordinary (non-Sunday, non-holiday) calendar time. Unrounded;
   * the caller rounds alongside the other buckets.
   */
  overtimeOnNonPremiumHrs: number;
}

/**
 * Split a closed shift across SAST days. A shift of at most 24h touches at
 * most two SAST calendar days, so the scan covers the clock-in day and the
 * next day (offsets 0 and 1).
 *
 * The OT tail is `[clockIn + dailyOrdinaryHrs, clockOut]` when the shift is
 * longer than `dailyOrdinaryHrs`, otherwise empty. We intersect that window
 * with each day's ordinary (non-premium) worked time to get
 * overtimeOnNonPremiumHrs.
 */
export function computeDayTypeHours(
  clockIn: Date,
  clockOut: Date,
  publicHolidays: ReadonlySet<string>,
  dailyOrdinaryHrs: number,
): DayTypeHours {
  let sundayMs = 0;
  let holidayMs = 0;
  let otNonPremiumMs = 0;

  // OT tail window: the chronological tail of the shift beyond the daily
  // ordinary threshold. Empty (start === end) when the shift is short.
  const otTailStart = new Date(clockIn.getTime() + dailyOrdinaryHrs * MS_PER_HOUR);
  const otTailEnd = clockOut.getTime() > otTailStart.getTime() ? clockOut : otTailStart;

  const startMidnight = sastMidnight(clockIn);
  for (let offsetDays = 0; offsetDays <= 1; offsetDays++) {
    const mid = new Date(startMidnight.getTime() + offsetDays * MS_PER_DAY);
    const nextMid = new Date(mid.getTime() + MS_PER_DAY);
    const workedMs = overlapMs(clockIn, clockOut, mid, nextMid);
    if (workedMs === 0) continue;

    const ymd = sastYmd(mid);
    const isHoliday = publicHolidays.has(ymd);
    const isSun = !isHoliday && isSunday(ymd);

    if (isHoliday) {
      holidayMs += workedMs;
    } else if (isSun) {
      sundayMs += workedMs;
    } else {
      // Ordinary calendar day: count the part of the OT tail that lands here.
      otNonPremiumMs += overlapMs(otTailStart, otTailEnd, mid, nextMid);
    }
  }

  return {
    sundayHrs: sundayMs / MS_PER_HOUR,
    holidayHrs: holidayMs / MS_PER_HOUR,
    overtimeOnNonPremiumHrs: otNonPremiumMs / MS_PER_HOUR,
  };
}
