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

/** `YYYY-MM-DD` only. Anything looser reaches Postgres as a date cast and 500s. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    if (value && !ISO_DATE.test(value)) {
      return { error: `${name} must be a date in YYYY-MM-DD form` };
    }
  }

  if (since && until && since > until) {
    // Lexical comparison is exact for ISO dates, and catching it here beats returning an
    // empty result that reads as "nobody worked".
    return { error: 'since must not be after until' };
  }

  // `roster` answers "who was here" — without a date it would mean "everyone, ever",
  // which is a different and much larger question than the one being asked.
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
