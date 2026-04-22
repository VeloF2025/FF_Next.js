/**
 * SA public-holiday helpers for the attendance overtime engine.
 *
 * The `public_holidays` table (seeded by migration 310) already stores the
 * OBSERVED date in its primary-key column — Public Holidays Act 36 of 1994
 * s1(3) rolls any Sunday-falling holiday to the following Monday. The
 * `observes_date` column preserves the original proclaimed date for audit.
 *
 * For payroll math we only care about the observed date, so the helpers
 * below return a Set of 'YYYY-MM-DD' strings that the calculator treats as
 * "holiday days." No rollover logic is needed at read time — it's already
 * baked into the seed.
 *
 * The calculator is a pure function; it receives the Set prebuilt. DB reads
 * happen in the reconcile cron, which batches a date range once per run.
 */

import { sql } from '@/lib/db-pool';

export type HolidayDate = string; // 'YYYY-MM-DD' (SAST calendar day)

/**
 * Load observed holiday dates within [fromDate, toDate] inclusive.
 * Both arguments are 'YYYY-MM-DD' strings in SAST — see sastWorkDate
 * in attendance/portal/clockUtils for the formatter.
 *
 * Returns an empty Set if the range contains no holidays (not an error).
 *
 * IMPORTANT — DO NOT wrap this call in a try/catch that returns an empty
 * Set on failure. A "no public holidays this month" misclassification
 * under-pays staff the s18 double-time. Connection failures must propagate
 * so the reconcile cron aborts the day's run (and the next run retries).
 */
export async function loadObservedHolidays(
  fromDate: HolidayDate,
  toDate: HolidayDate
): Promise<Set<HolidayDate>> {
  if (!isValidYmd(fromDate) || !isValidYmd(toDate)) {
    throw new Error(
      `loadObservedHolidays requires YYYY-MM-DD dates; got from=${fromDate} to=${toDate}`
    );
  }
  if (fromDate > toDate) {
    throw new Error(
      `loadObservedHolidays: fromDate (${fromDate}) must be <= toDate (${toDate})`
    );
  }

  const rows = await sql<{ date: string }>`
    SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
    FROM public_holidays
    WHERE date >= ${fromDate}::date
      AND date <= ${toDate}::date
  `;
  return new Set(rows.map((r) => r.date));
}

/**
 * Predicate form used inside the pure calculator. Kept separate from the
 * DB loader so the calculator itself does no IO.
 */
export function isHolidayDate(
  workDate: HolidayDate,
  holidays: ReadonlySet<HolidayDate>
): boolean {
  return holidays.has(workDate);
}

/**
 * Returns true if the given work-date string lands on a Sunday in the SAST
 * calendar. Parsing `YYYY-MM-DDT00:00:00Z` gives midnight UTC on that date,
 * which is 02:00 SAST on the SAME calendar day (SAST is UTC+2, no DST), so
 * the weekday is stable across the two timezones. Safe.
 *
 * This is the pivot used by BCEA s16: staff who do not ordinarily work
 * Sundays earn 2× on Sunday hours; staff who do earn 1.5×.
 */
export function isSunday(workDate: HolidayDate): boolean {
  if (!isValidYmd(workDate)) {
    throw new Error(`isSunday requires YYYY-MM-DD; got ${workDate}`);
  }
  // UTC weekday on a date-only string is stable vs. SAST (see comment above)
  return new Date(`${workDate}T00:00:00Z`).getUTCDay() === 0;
}

function isValidYmd(s: unknown): s is HolidayDate {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
}
