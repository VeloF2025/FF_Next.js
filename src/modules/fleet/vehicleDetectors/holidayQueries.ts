/**
 * The public-holiday calendar the after-hours rule consults.
 *
 * `public_holidays` (migration 310) is already the authoritative SA calendar,
 * seeded 2026–2028 with the Public Holidays Act s1(3) Sunday→Monday rollover
 * applied. Nothing here re-derives it, and no detector may carry a hand-written
 * list of dates.
 *
 * The dates come back as TEXT from `to_char`, not as a DATE. node-postgres
 * parses a DATE (OID 1082) into a JS `Date` at LOCAL midnight, and formatting
 * that through `toISOString()` shifts it a day backwards in SAST — which would
 * mark the day BEFORE Freedom Day as the holiday. Formatting in Postgres skips
 * the round trip entirely.
 */

import { query } from '@/lib/db-pool';

interface HolidayRow extends Record<string, unknown> {
  holiday_date: string;
}

/**
 * Every observed public holiday in `[fromDate, toDate]`, as `YYYY-MM-DD`.
 *
 * Both bounds are inclusive `YYYY-MM-DD` calendar dates.
 */
export async function loadHolidays(fromDate: string, toDate: string): Promise<Set<string>> {
  const rows = await query<HolidayRow>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS holiday_date
       FROM public_holidays
      WHERE date >= $1::date AND date <= $2::date
      ORDER BY date`,
    [fromDate, toDate],
  );
  return new Set(rows.map((row) => row.holiday_date));
}
