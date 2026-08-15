/**
 * Turning attendance rows into an answer, with the caveats that stop it being misread.
 *
 * Split from attendance.ts to keep both inside the 300-line rule. The caveats are the
 * substance here, not decoration: every one of them exists because a specific true-looking
 * sentence would otherwise be false — a per-person total that is a floor, provisional
 * hours read as pay, a leaver described as current staff, a partial sum quoted as a
 * period, and an empty result blamed on missing data when it is actually missing access.
 */

import type { AttendanceFilter } from './attendanceFilter';
import type { AttendanceDayRow } from './attendance';

/**
 * A numeric(5,2) column arrives from node-postgres as a STRING, so `+r.regular_hrs` on a
 * null yields 0 and a missing value becomes a confident zero hours. Null stays null.
 */
function hoursOrNull(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
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
    /**
     * Summed over the days SHOWN, not over daysMatched.
     *
     * Named `…HoursShown` because the previous name sat beside `daysMatched` and read as
     * a total for the whole match set: a default call reported 3,536 hours that were
     * actually the alphabetically-first 8 of 54 people, cut mid-person. This is the
     * number a reader quotes, so the name has to carry the qualifier.
     */
    regularHoursShown: number | null;
    overtimeHoursShown: number | null;
    /** True when daysShown < daysMatched, i.e. the hours above are a partial sum. */
    hoursArePartial: boolean;
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
  /**
   * REQUIRED, like allowedStaffIds on the query.
   *
   * Leaving it optional half-enforced the pairing: a caller could scope the query and
   * then omit the note, producing a supervisor's slice presented with no indication that
   * it was one. Pass `{ kind: 'orgwide' }` when the caller genuinely sees everything.
   */
  scopeNote: { kind: string; reason?: string; staffCount?: number },
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
      `Showing ${days.length} of ${matched} matching days, so regularHoursShown and ` +
        'overtimeHoursShown are a PARTIAL sum over those days only — not a total for the ' +
        'period. Narrow with since/until or person rather than quoting these as the whole.',
    );
  }

  // Scope FIRST, and the empty-result explanation only when scope is not the reason.
  //
  // The two together were a trap: an empty result for a caller who supervises nobody was
  // explained as "nothing was RECORDED for this query — not that nobody worked", which is
  // false. The records exist; the caller cannot see them. An agent reading the first
  // caveat would report no attendance for a period holding 2,700+ days of it — the same
  // class of misstatement this caveat was added to prevent.
  const orgWide = !scopeNote || scopeNote.kind === 'orgwide';

  if (!orgWide) {
    caveats.push(
      scopeNote.kind === 'no_scope'
        ? `You have no staff in scope, so this returns nothing regardless of the filters — ` +
          `that is about your access, NOT about whether anyone worked. ${scopeNote.reason ?? ''}`.trim()
        : `Limited to the ${scopeNote.staffCount ?? 'some'} staff you supervise — this is NOT the whole organisation.`,
    );
  }

  if (days.length === 0 && orgWide) {
    caveats.push(
      'No attendance records matched. That means nothing was RECORDED for this query — ' +
        'not that nobody worked. Daily summaries begin 2026-04-25 and day exceptions ' +
        'begin 2026-07-13; before those dates there is no data either way.',
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
      regularHoursShown: sum((d) => d.regularHours),
      overtimeHoursShown: sum((d) => d.overtimeHours),
      hoursArePartial: matched > days.length,
    },
    caveats,
  };
}
