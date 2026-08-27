/**
 * The public-holiday calendar the after-hours rule consults.
 *
 * There is already exactly one loader for this, and it is not here:
 * `loadObservedHolidays` in `src/services/attendance/saPublicHolidays.ts`, which
 * the BCEA overtime engine has read migration 310's `public_holidays` through
 * since it shipped. This module re-exports it under the name the detector
 * modules use, and adds nothing.
 *
 * Why not a second query of its own — it would only be four lines:
 *
 *   * `public_holidays.date` is a DATE, and node-postgres parses a DATE
 *     (OID 1082) into a JS `Date` at LOCAL midnight. Formatting that through
 *     `toISOString()` shifts it a day backwards in SAST, marking the day BEFORE
 *     Freedom Day as the holiday. `loadObservedHolidays` formats with `to_char`
 *     in Postgres and skips the round trip. A copy is a second place for that
 *     trap to come back.
 *   * It validates both bounds as `YYYY-MM-DD` and rejects an inverted range,
 *     and it documents — at length — why it must never swallow a connection
 *     failure into an empty Set. Under-reporting holidays under-pays staff
 *     there; here it silently disarms the after-hours detectors. Same rule,
 *     same reason to keep it in one place.
 *
 * The observed date is already the s1(3) Sunday→Monday rollover: no rollover
 * logic belongs at read time.
 */

export { loadObservedHolidays as loadHolidays, type HolidayDate } from '@/services/attendance/saPublicHolidays';
