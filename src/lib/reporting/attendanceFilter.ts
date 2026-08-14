/**
 * What an attendance query may ask for.
 *
 * Split from the query builder so the accepted inputs can be read in one place — this
 * tool takes more parameters than the other reports and every one of them narrows access
 * to staff personal data.
 */

/** The three questions the tool answers. Anything else is rejected, not defaulted. */
export const ATTENDANCE_MODES = ['person', 'roster', 'exceptions'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export function isAttendanceMode(value: unknown): value is AttendanceMode {
  return typeof value === 'string' && (ATTENDANCE_MODES as readonly string[]).includes(value);
}

/**
 * A day of attendance per person is one row, so a month for the whole workforce is ~2,000.
 * The cap is generous enough for a real question and bounded enough that a careless
 * "everyone, all time" cannot walk the table.
 */
export const MAX_ATTENDANCE_ROWS = 500;

export interface AttendanceFilter {
  mode: AttendanceMode;
  /** Free-text name match. See the caveat in shapeAttendance — this is a FLOOR. */
  person?: string;
  since?: string;
  until?: string;
  /** exceptions mode only: include those already resolved or cancelled. */
  includeResolved: boolean;
  limit: number;
}

/** `YYYY-MM-DD` shape. Shape alone is not enough — see isRealDate. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date that exists.
 *
 * The regex matches `0000-00-00`, `2026-02-30` and `2026-13-01`, all of which reach
 * Postgres as a `::date` cast and throw — turning a client's typo into a 500 and a log
 * line. Round-tripping through Date catches every one: an invalid day rolls over, so the
 * formatted result differs from the input.
 */
function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return false;
  // setUTCFullYear, not the Date.UTC constructor: that maps years 0-99 to 1900+y, so
  // every year before 0100 was rejected as impossible.
  const dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y);
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined;
  return value;
}

export function parseAttendanceFilter(
  query: Record<string, string | string[] | undefined>,
): { filter: AttendanceFilter } | { error: string } {
  const mode = one(query.mode) ?? 'person';
  if (!isAttendanceMode(mode)) {
    return { error: `mode must be one of: ${ATTENDANCE_MODES.join(', ')}` };
  }

  const person = one(query.person)?.trim();
  const since = one(query.since)?.trim();
  const until = one(query.until)?.trim();
  const includeResolved = one(query.includeResolved) === 'true';
  const rawLimit = one(query.limit)?.trim();

  for (const [name, value] of [['since', since], ['until', until]] as const) {
    if (value && (!ISO_DATE.test(value) || !isRealDate(value))) {
      return { error: `${name} must be a real date in YYYY-MM-DD form` };
    }
  }

  if (since && until && since > until) {
    // Lexical comparison is exact for ISO dates, and catching it here beats returning an
    // empty result that reads as "nobody worked".
    return { error: 'since must not be after until' };
  }

  // EVERY mode needs a bound, not just roster.
  //
  // Guarding roster alone was decorative: `person` is the default, and with no person and
  // no dates it issued the identical whole-workforce, all-time query — only the ORDER BY
  // differed. `get_attendance()` with no arguments did exactly that and returned every
  // summary row in the system. A question about attendance is always about somebody or
  // some period; "everyone, ever" is not a question anyone asked.
  // `exceptions` is self-bounding and exempt: it returns only days still awaiting
  // somebody, of which there are ~1,100 in total, under the same 500 cap. "What is
  // outstanding" is the natural phrasing of that question and requiring a date for it
  // removed a legitimate call without closing any real exposure.
  //
  // A one-character `person` satisfies this rule while matching thousands of days, so it
  // is a statement of intent rather than a volume control — the cap and the partial-total
  // flag are what bound the volume. Two characters at least stops a bare letter.
  const bounded =
    mode === 'exceptions' ||
    (person ? person.length >= 2 : false) ||
    Boolean(since) ||
    Boolean(until);
  if (!bounded) {
    return {
      error:
        'Narrow the query: give `person` (at least two characters), or a `since`/`until` ' +
        'range. Without either this would return every attendance record for every person.',
    };
  }
  if (mode === 'roster' && !since) {
    return { error: 'roster mode needs at least `since` (a single date is fine)' };
  }

  let limit = MAX_ATTENDANCE_ROWS;
  if (rawLimit) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
      return { error: 'limit must be a positive integer' };
    }
    limit = Math.min(MAX_ATTENDANCE_ROWS, Number(rawLimit));
  }

  return { filter: { mode, person: person || undefined, since, until, includeResolved, limit } };
}
