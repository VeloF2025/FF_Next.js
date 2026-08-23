/**
 * SAST calendar arithmetic for the analytics pipeline.
 *
 * Every date question in this module is a South African calendar question, and
 * every one of them has a plausible-looking UTC answer that is wrong by up to
 * two hours - which is up to one whole day at a month boundary. Rather than
 * leave that reasoning duplicated at each call site, all of it lives here and
 * is pinned by one test file.
 *
 * The specific trap this file exists to contain: node-postgres parses a DATE
 * column (OID 1082) into a JS `Date` at LOCAL midnight. Calling `toISOString()`
 * on that shifts it backwards across the date line in any positive-offset zone,
 * so a work date of the 1st is silently reported as the last day of the
 * previous month - and lands in the wrong aggregate. `toWorkDate` reads the
 * calendar parts directly and never formats through UTC.
 */

/** South African Standard Time. No DST, so a fixed offset is safe here. */
const SAST_TIME_ZONE = 'Africa/Johannesburg';

/**
 * A `YYYY-MM-DD` work date from whatever the driver handed back.
 *
 * A string is already in the right shape and is trimmed to the date part. A
 * `Date` is read through its LOCAL parts, never through `toISOString()`.
 */
export function toWorkDate(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * The SAST month an instant falls in, as `YYYY-MM-01`.
 *
 * Formatted through `Intl` in the SAST zone rather than by arithmetic on the
 * UTC parts: an instant at 22:30 UTC on the last of a month is already the 1st
 * in Johannesburg and belongs to the NEXT month's aggregate.
 */
export function sastMonthStart(at: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAST_TIME_ZONE, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(at));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  if (!year || !month) throw new Error(`Could not resolve a SAST month for ${at}`);
  return `${year}-${month}-01`;
}

/** `monthStart` shifted by `delta` months, still as `YYYY-MM-01`. */
export function shiftMonth(monthStart: string, delta: number): string {
  const [year, month] = monthStart.split('-').map(Number);
  if (!year || !month) throw new Error(`Not a month start: ${monthStart}`);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Every calendar date in the month starting at `monthStart`, as `YYYY-MM-DD`.
 *
 * Day 0 of the FOLLOWING month is the last day of this one, which is how
 * February and leap years are handled without a table of month lengths.
 */
export function datesInMonth(monthStart: string): string[] {
  const [year, month] = monthStart.split('-').map(Number);
  if (!year || !month) throw new Error(`Not a month start: ${monthStart}`);
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: dayCount },
    (_, i) => `${monthStart.slice(0, 8)}${String(i + 1).padStart(2, '0')}`,
  );
}

/** End of the work date in SAST - the instant that day's statuses are final. */
export function endOfWorkDate(workDate: string): string {
  return new Date(`${workDate}T23:59:59+02:00`).toISOString();
}
