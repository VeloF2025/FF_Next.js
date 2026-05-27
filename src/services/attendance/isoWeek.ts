/**
 * ISO-week Monday helper — shared by the reconcile orchestrator (cron-side
 * week grouping) and the weekly-locks module (UI + API-side week gating).
 *
 * Pure, no DB, no timezone dependency: the input is a SAST calendar day
 * (`YYYY-MM-DD`) and parsing `YYYY-MM-DDT00:00:00Z` gives midnight UTC on
 * the same calendar day as midnight SAST (SAST is UTC+2, stable weekday).
 *
 * Two implementations of this existed pre-hardening (reconcile.ts + the
 * corrections-module lockQueries.ts); drift between them could silently
 * misassign lock weeks vs. cron week groupings. Consolidating here —
 * both modules import this one.
 */

/**
 * Normalise accepted input (`string | Date`) into a `YYYY-MM-DD` string.
 *
 * The pg driver returns Postgres `DATE` columns as JS `Date` objects at
 * midnight UTC of the calendar day, so `Date` inputs flow in wherever a
 * handler reads `row.work_date` directly without casting to text. Being
 * tolerant here prevents the class of 500 we hit on 2026-04-24 where the
 * driver-returned Date got String-coerced to
 * `"Fri Apr 24 2026 00:00:00 GMT+0200 ..."` and blew the regex.
 *
 * Throws when the input is neither a valid YYYY-MM-DD string nor a
 * parseable Date.
 */
function normaliseYmd(input: string | Date): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new Error(`isoWeekMonday: unparseable Date input`);
    }
    // Use UTC getters because pg returns DATE as midnight UTC of the
    // calendar day. Using local getters would silently shift the day in
    // timezones west of UTC.
    const y = input.getUTCFullYear();
    const m = String(input.getUTCMonth() + 1).padStart(2, '0');
    const d = String(input.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`isoWeekMonday: invalid YYYY-MM-DD input '${String(input)}'`);
  }
  return input;
}

export function isoWeekMonday(input: string | Date): string {
  const ymd = normaliseYmd(input);
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`isoWeekMonday: unparseable date '${ymd}'`);
  }
  const dow = d.getUTCDay(); // 0 Sun..6 Sat
  const deltaToMon = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + deltaToMon);
  return d.toISOString().slice(0, 10);
}
