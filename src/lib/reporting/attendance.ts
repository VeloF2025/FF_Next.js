/**
 * Attendance queries for reporting — staff and field workers.
 *
 * THREE COLUMN GROUPS ARE NEVER SELECTED, in any mode:
 *
 *   money       attendance_daily_summaries.wage_amount_cents,
 *               hourly_rate_snapshot_cents            — pay, not attendance
 *   location    attendance_entries.clock_in_lat/lon,
 *               clock_out_lat/lon                     — where a named person stood
 *   biometrics  attendance_entries.selfie_in_url,
 *               selfie_out_url                        — present on all 2,124 entries
 *
 * The question asked was "who worked when". None of those three answer it, all three are
 * a different and larger disclosure, and an agent that can reach them can put them in a
 * chat log. `attendanceQuery` is covered by a test asserting the generated SQL mentions
 * none of them, so adding one back is a test failure rather than a review comment.
 *
 * Field workers ARE included. src/lib/staff/hrVisibilityFilters.ts deliberately hides
 * `role IN ('technician','casual')` from HR and payroll surfaces, and that predicate is
 * deliberately NOT applied here: it exists so self-registered workers do not contaminate
 * payroll runs, not because their attendance is secret — and covering them was the
 * explicit ask. Note that no staff row currently carries `role = 'casual'`; today's field
 * workers are all `technician`.
 */

import type { AttendanceFilter } from './attendanceFilter';

/**
 * A numeric(5,2) column arrives from node-postgres as a STRING, so `+r.regular_hrs` on a
 * null yields 0 and a missing value becomes a confident zero hours. Null stays null.
 */
function hoursOrNull(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Statuses that mean an exception is still someone's problem. */
const UNRESOLVED = ['open', 'awaiting_worker', 'awaiting_supervisor'];

export interface AttendanceDayRow {
  staff_id: string;
  staff_name: string | null;
  staff_role: string | null;
  staff_status: string | null;
  work_date: Date | string | null;
  regular_hrs: string | number | null;
  overtime_hrs: string | number | null;
  sunday_hrs: string | number | null;
  holiday_hrs: string | number | null;
  result_status: string | null;
  exceptions: Array<{ kind: string; status: string }> | null;
  total_matched?: number;
}

/** `alias.name`, falling back to first+last for rows where the combined column is null. */
const STAFF_NAME = `COALESCE(NULLIF(TRIM(s.name), ''),
                            NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''))`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Build the query for a mode.
 *
 * All three read from attendance_daily_summaries as the spine, because that is the table
 * with computed hours per (staff_id, work_date). attendance_day_exceptions is LEFT
 * JOINed — it is the per-day workflow table, paired with the summary on the same key.
 * (There is a second table called attendance_exceptions; it is entry-level detection
 * data keyed on entry_id, and is NOT this.)
 */
export function attendanceQuery(filter: AttendanceFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const push = (value: unknown) => `$${params.push(value)}`;

  // `TRUE`, not `1=1` — the latter is indistinguishable from an injection payload when
  // reading the generated SQL, and a test asserting "no 1=1 reached the query" then trips
  // on our own base clause.
  const where: string[] = ['TRUE'];

  if (filter.person) {
    // Matched against the name as typed into the staff record. See the caveat: one
    // person can hold more than one spelling, so a per-person total is a floor.
    where.push(`${STAFF_NAME} ILIKE ${push(`%${escapeLike(filter.person)}%`)}`);
  }
  const dateRef = filter.mode === 'exceptions' ? 'x.work_date' : 'd.work_date';
  if (filter.since) where.push(`${dateRef} >= ${push(filter.since)}::date`);
  if (filter.until) where.push(`${dateRef} <= ${push(filter.until)}::date`);

  if (filter.mode === 'exceptions') {
    // An exception is the reason for the row, so it must exist...
    where.push('x.exceptions IS NOT NULL');
    // ...and unless asked otherwise, only days still awaiting somebody.
    if (!filter.includeResolved) where.push('x.has_unresolved');
  }

  // roster reads most-recent-first within a day so a day's list is stable; person reads
  // chronologically because it is a timeline.
  // Ordered on the CTE's OUTPUT columns, not on the `s.`/`d.` expressions — those
  // aliases do not exist outside the CTE and referencing them raises 42P01.
  const order =
    filter.mode === 'person'
      ? 'ORDER BY sc.staff_name ASC, sc.work_date ASC'
      : 'ORDER BY sc.work_date DESC, sc.staff_name ASC';

  // The SPINE differs by mode, deliberately.
  //
  // person/roster start from the daily summary, because the question is "what hours".
  // exceptions starts from the exceptions themselves, because the question is "what needs
  // review" — and measured against live data, 53 of the 1,109 exception-days have NO
  // summary row at all (they are exactly the cancelled ones). Anchoring exceptions on
  // summaries made those days invisible, which silently turned `include_resolved` into a
  // no-op: it returned 1,056 either way.
  const exceptionSpine = filter.mode === 'exceptions';

  const from = exceptionSpine
    ? `FROM (
             SELECT xx.staff_id, xx.work_date,
                    jsonb_agg(jsonb_build_object('kind', xx.kind, 'status', xx.status)
                              ORDER BY xx.created_at) AS exceptions,
                    bool_or(xx.status = ANY(${push(UNRESOLVED)})) AS has_unresolved
               FROM attendance_day_exceptions xx
              GROUP BY xx.staff_id, xx.work_date
           ) x
           JOIN staff s ON s.id = x.staff_id
           LEFT JOIN attendance_daily_summaries d
                  ON d.staff_id = x.staff_id AND d.work_date = x.work_date`
    : `FROM attendance_daily_summaries d
           JOIN staff s ON s.id = d.staff_id
           -- LATERAL and aggregated, NOT a plain join: 154 days carry two exceptions, and
           -- joining rows would duplicate those summaries — inflating the day count and
           -- DOUBLE-COUNTING their hours in the totals.
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object('kind', xx.kind, 'status', xx.status)
                              ORDER BY xx.created_at) AS exceptions,
                    bool_or(xx.status = ANY(${push(UNRESOLVED)})) AS has_unresolved
               FROM attendance_day_exceptions xx
              WHERE xx.staff_id = d.staff_id AND xx.work_date = d.work_date
           ) x ON TRUE`;

  // The date column comes from whichever table is the spine; on the exceptions spine a
  // day may have no summary, so its hours are genuinely null rather than zero.
  const dateCol = exceptionSpine ? 'x.work_date' : 'd.work_date';
  const staffIdCol = exceptionSpine ? 'x.staff_id' : 'd.staff_id';

  return {
    sql: `
      WITH scoped AS (
        SELECT ${staffIdCol} AS staff_id,
               ${STAFF_NAME} AS staff_name,
               s.role   AS staff_role,
               s.status AS staff_status,
               ${dateCol} AS work_date,
               d.regular_hrs, d.overtime_hrs, d.sunday_hrs, d.holiday_hrs,
               d.result_status,
               x.exceptions
          ${from}
         WHERE ${where.join('\n           AND ')}
      )
      SELECT sc.*, (SELECT count(*) FROM scoped)::int AS total_matched
        FROM scoped sc
        ${order}
        LIMIT ${push(filter.limit)}`,
    params,
  };
}

export interface AttendanceReport {
  mode: string;
  days: Array<{
    staffId: string;
    name: string;
    role: string | null;
    employmentStatus: string | null;
    date: string | null;
    regularHours: number | null;
    overtimeHours: number | null;
    sundayHours: number | null;
    holidayHours: number | null;
    approvalStatus: string | null;
    /** Every exception raised for that day — a day can carry more than one. */
    exceptions: Array<{ kind: string; status: string }>;
  }>;
  totals: {
    daysShown: number;
    daysMatched: number;
    peopleShown: number;
    regularHours: number | null;
    overtimeHours: number | null;
  };
  caveats: string[];
}

/** A DATE from node-postgres arrives as a local-midnight Date; format from local parts. */
function day(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shapeAttendance(
  rows: AttendanceDayRow[],
  filter: AttendanceFilter,
): AttendanceReport {
  const matched = rows[0]?.total_matched ?? 0;

  const days = rows.map((r) => ({
    staffId: r.staff_id,
    name: r.staff_name ?? '(unnamed staff record)',
    role: r.staff_role,
    employmentStatus: r.staff_status,
    date: day(r.work_date),
    regularHours: hoursOrNull(r.regular_hrs),
    overtimeHours: hoursOrNull(r.overtime_hrs),
    sundayHours: hoursOrNull(r.sunday_hrs),
    holidayHours: hoursOrNull(r.holiday_hrs),
    approvalStatus: r.result_status,
    exceptions: r.exceptions ?? [],
  }));

  const sum = (pick: (d: (typeof days)[number]) => number | null): number | null => {
    const values = days.map(pick).filter((v): v is number => v !== null);
    return values.length ? Number(values.reduce((a, b) => a + b, 0).toFixed(2)) : null;
  };

  const caveats: string[] = [];

  if (filter.person) {
    caveats.push(
      'The person filter matches the name on the staff record as free text. One person can ' +
        'appear under more than one spelling, so any per-person total here is a FLOOR, not a count.',
    );
  }

  const unapproved = days.filter((d) => d.approvalStatus !== 'approved' && d.approvalStatus !== 'locked');
  if (unapproved.length) {
    caveats.push(
      `${unapproved.length} of ${days.length} days shown are not approved or locked, so their ` +
        'hours are provisional and may still change. Do not present them as final or as payroll figures.',
    );
  }

  const leavers = days.filter((d) => d.employmentStatus && d.employmentStatus !== 'active');
  if (leavers.length) {
    const names = [...new Set(leavers.map((d) => d.name))];
    caveats.push(
      `Includes ${names.length} person(s) who are no longer active staff (${names.slice(0, 5).join(', ')}` +
        `${names.length > 5 ? ', …' : ''}). Their records are historical — do not describe them as current staff.`,
    );
  }

  if (matched > days.length) {
    caveats.push(
      `Showing ${days.length} of ${matched} matching days. Narrow with since/until or person ` +
        'rather than treating this as the complete picture.',
    );
  }

  if (filter.mode === 'exceptions') {
    caveats.push(
      'An exception is a day flagged for review — most commonly a missing clock-in. It records ' +
        'that the DATA needs attention, not that the person did anything wrong, and the large ' +
        'awaiting_supervisor backlog is a queue nobody has worked through rather than a finding.',
    );
  }

  return {
    mode: filter.mode,
    days,
    totals: {
      daysShown: days.length,
      daysMatched: matched,
      peopleShown: new Set(days.map((d) => d.staffId)).size,
      regularHours: sum((d) => d.regularHours),
      overtimeHours: sum((d) => d.overtimeHours),
    },
    caveats,
  };
}
