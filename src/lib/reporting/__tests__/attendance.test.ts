/**
 * Attendance query and shaping.
 *
 * The row-level guarantees — no fan-out, the right spine per mode — are proven by
 * execution in tests/db/action-items/attendance.lifecycle.test.ts. What is pinned here is
 * the input handling and, most importantly, the columns this tool must NEVER select.
 */

import { describe, expect, it } from 'vitest';

import { parseAttendanceFilter, MAX_ATTENDANCE_ROWS } from '../attendanceFilter';
import { attendanceQuery, shapeAttendance, type AttendanceDayRow } from '../attendance';

function filter(query: Record<string, string | string[] | undefined> = {}) {
  // Every query now needs a bound; supply one unless the case sets its own.
  if (!query.person && !query.since && !query.until) query = { ...query, person: 'someone' };
  const parsed = parseAttendanceFilter(query);
  if ('error' in parsed) throw new Error(`unexpected rejection: ${parsed.error}`);
  return parsed.filter;
}

describe('parseAttendanceFilter', () => {
  it('defaults to person mode', () => {
    expect(filter().mode).toBe('person');
  });

  it.each(['wages', 'payroll', '', 'PERSON', 'anything'])('rejects mode=%j', (mode) => {
    // Rejected, never defaulted — a typo silently becoming `person` would answer a
    // different question than the one asked.
    expect('error' in parseAttendanceFilter({ mode })).toBe(true);
  });

  it.each(['not-a-date', '2026-7-1', '01-01-2026', "2026-01-01'; DROP TABLE staff"])(
    'rejects %j as a date',
    (value) => {
      expect('error' in parseAttendanceFilter({ since: value })).toBe(true);
      expect('error' in parseAttendanceFilter({ until: value })).toBe(true);
    },
  );

  it('rejects a reversed date range rather than returning nothing', () => {
    // An empty result here reads as "nobody worked", which is a false statement about
    // people rather than about the query.
    expect('error' in parseAttendanceFilter({ since: '2026-08-01', until: '2026-07-01' })).toBe(true);
  });

  it('refuses an unbounded query in EVERY mode, not just roster', () => {
    // The default call — get_attendance() with no arguments — used to return every
    // attendance record for every person.
    expect('error' in parseAttendanceFilter({})).toBe(true);
    expect('error' in parseAttendanceFilter({ mode: 'person' })).toBe(true);
    expect('error' in parseAttendanceFilter({ mode: 'exceptions' })).toBe(true);
    // Any one bound is enough.
    expect('error' in parseAttendanceFilter({ person: 'jaun' })).toBe(false);
    expect('error' in parseAttendanceFilter({ since: '2026-08-01' })).toBe(false);
    expect('error' in parseAttendanceFilter({ until: '2026-08-01' })).toBe(false);
  });

  it.each(['0000-00-00', '2026-02-30', '2026-13-01', '2026-00-10'])(
    'rejects %j — a shape-only regex lets it reach ::date and 500',
    (value) => {
      expect('error' in parseAttendanceFilter({ since: value, person: 'x' })).toBe(true);
    },
  );

  it('accepts a real leap day', () => {
    expect('error' in parseAttendanceFilter({ since: '2028-02-29', person: 'x' })).toBe(false);
  });

  it('requires a date for roster mode', () => {
    // "Who was here" without a date means "everyone, ever" — a different question.
    expect('error' in parseAttendanceFilter({ mode: 'roster' })).toBe(true);
    expect('error' in parseAttendanceFilter({ mode: 'roster', since: '2026-08-12' })).toBe(false);
  });

  it('clamps and validates the limit', () => {
    expect(filter({ limit: '999999' }).limit).toBe(MAX_ATTENDANCE_ROWS);
    expect(filter({}).limit).toBe(MAX_ATTENDANCE_ROWS);
    expect('error' in parseAttendanceFilter({ limit: '0' })).toBe(true);
    expect('error' in parseAttendanceFilter({ limit: 'abc' })).toBe(true);
  });

  it('treats includeResolved as off unless explicitly true', () => {
    expect(filter({ mode: 'exceptions' }).includeResolved).toBe(false);
    expect(filter({ mode: 'exceptions', includeResolved: 'false' }).includeResolved).toBe(false);
    expect(filter({ mode: 'exceptions', includeResolved: 'true' }).includeResolved).toBe(true);
  });

  it('takes the first value of a repeated parameter', () => {
    expect(filter({ person: ['a', 'b'] }).person).toBe('a');
  });
});

describe('supervisor scope', () => {
  it('filters to the allowed staff when the caller is scoped', () => {
    // 11 of 14 staff-linked managers supervise exactly themselves. Without this the key
    // alone would hand them all 54 people with attendance.
    const { sql, params } = attendanceQuery(filter({ person: 'x' }), ['abc', 'def']);
    expect(sql).toContain('staff_id = ANY(');
    expect(params).toContainEqual(['abc', 'def']);
  });

  it('treats an EMPTY allow-list as "nobody", not as "no filter"', () => {
    const { sql, params } = attendanceQuery(filter({ person: 'x' }), []);
    expect(sql).toContain('staff_id = ANY(');
    expect(params).toContainEqual([]);
  });

  it('omits the filter only for an org-wide caller', () => {
    expect(attendanceQuery(filter({ person: 'x' }), null).sql).not.toContain('staff_id = ANY(');
  });

  it('scopes the exceptions mode on its own spine alias', () => {
    const { sql } = attendanceQuery(filter({ mode: 'exceptions', person: 'x' }), ['abc']);
    expect(sql).toContain('x.staff_id = ANY(');
  });
});

describe('attendanceQuery — what it must never select', () => {
  // The tool answers "who worked when". Pay, location and photographs are each a
  // different and larger disclosure, and an agent that can reach them can paste them
  // into a chat log. Adding one back should fail a test, not wait for a reviewer.
  const FORBIDDEN = [
    'wage_amount_cents',
    'hourly_rate_snapshot_cents',
    'clock_in_lat',
    'clock_in_lon',
    'clock_out_lat',
    'clock_out_lon',
    'selfie_in_url',
    'selfie_out_url',
  ];

  it.each(['person', 'roster', 'exceptions'])('mode=%s selects no pay, location or photo column', (mode) => {
    const { sql } = attendanceQuery(filter(mode === 'roster' ? { mode, since: '2026-08-01' } : { mode }), null);
    for (const column of FORBIDDEN) {
      expect(sql).not.toContain(column);
    }
  });

  it('does not even read the entries table, where those columns live', () => {
    const { sql } = attendanceQuery(filter(), null);
    expect(sql).not.toContain('attendance_entries');
  });
});

describe('attendanceQuery', () => {
  it('binds every user value rather than interpolating it', () => {
    const nasty = "' OR 1=1 --";
    const { sql, params } = attendanceQuery(filter({ person: nasty, since: '2026-01-01' }), null);
    expect(sql).not.toContain('1=1');
    expect(params.some((p) => String(p).includes('1=1'))).toBe(true);
  });

  it('escapes LIKE metacharacters so a bare % matches nothing', () => {
    const { params } = attendanceQuery(filter({ person: '%' }), null);
    expect(params).toContain('%\\%%');
  });

  it('reads exceptions from the day-level table, not the entry-level one', () => {
    // attendance_exceptions is entry-level detection data keyed on entry_id and is a
    // different table with a confusingly similar name.
    const { sql } = attendanceQuery(filter({ mode: 'exceptions' }), null);
    expect(sql).toContain('attendance_day_exceptions');
    expect(sql).not.toMatch(/FROM attendance_exceptions\b/);
  });

  it('aggregates exceptions per day rather than joining rows', () => {
    // 154 live days carry two exceptions; a plain join would duplicate those summaries
    // and double-count their hours.
    const { sql } = attendanceQuery(filter(), null);
    expect(sql).toContain('jsonb_agg');
  });

  it('anchors exceptions mode on the exceptions table, not on summaries', () => {
    // 53 live exception-days have no summary row. Anchoring on summaries hid them, which
    // silently made include_resolved a no-op.
    const { sql } = attendanceQuery(filter({ mode: 'exceptions' }), null);
    const from = sql.slice(sql.indexOf('FROM'));
    expect(from.indexOf('attendance_day_exceptions')).toBeLessThan(from.indexOf('attendance_daily_summaries'));
  });

  it('applies the unresolved filter only when resolved ones are not wanted', () => {
    expect(attendanceQuery(filter({ mode: 'exceptions' }), null).sql).toContain('x.has_unresolved');
    expect(
      attendanceQuery(filter({ mode: 'exceptions', includeResolved: 'true' }), null).sql,
    ).not.toContain('AND x.has_unresolved');
  });
});

describe('shapeAttendance', () => {
  const row = (over: Partial<AttendanceDayRow> = {}): AttendanceDayRow => ({
    staff_id: 's1',
    staff_name: 'Jaun Smit',
    staff_role: null,
    staff_status: 'active',
    work_date: new Date(2026, 7, 12),
    regular_hrs: '8.00',
    overtime_hrs: '1.50',
    sunday_hrs: '0.00',
    holiday_hrs: '0.00',
    result_status: 'approved',
    exceptions: null,
    total_matched: 1,
    ...over,
  });

  it('formats the date from local parts, not toISOString', () => {
    // A DATE arrives as a local-midnight Date; toISOString would move it a day earlier.
    expect(shapeAttendance([row()], filter()).days[0].date).toBe('2026-08-12');
  });

  it('parses numeric hours that arrive as strings', () => {
    const day = shapeAttendance([row()], filter()).days[0];
    expect(day.regularHours).toBe(8);
    expect(day.overtimeHours).toBe(1.5);
  });

  it('keeps a missing hour value null rather than calling it zero', () => {
    // `+null` is 0, which would report a day with no computed hours as a day off.
    const day = shapeAttendance([row({ regular_hrs: null })], filter()).days[0];
    expect(day.regularHours).toBeNull();
  });

  it('warns that a person total is a floor', () => {
    const caveats = shapeAttendance([row()], filter({ person: 'jaun' })).caveats.join(' ');
    expect(caveats).toContain('FLOOR');
  });

  it('warns when days are not approved, so hours are provisional', () => {
    const caveats = shapeAttendance([row({ result_status: null })], filter()).caveats.join(' ');
    expect(caveats).toContain('provisional');
  });

  it('does not warn about approval when every day is approved or locked', () => {
    const caveats = shapeAttendance(
      [row({ result_status: 'approved' }), row({ result_status: 'locked' })],
      filter(),
    ).caveats.join(' ');
    expect(caveats).not.toContain('provisional');
  });

  it('names people who have left, so they are not described as current staff', () => {
    const caveats = shapeAttendance(
      [row({ staff_status: 'resigned', staff_name: 'Ex Employee' })],
      filter(),
    ).caveats.join(' ');
    expect(caveats).toContain('no longer active');
    expect(caveats).toContain('Ex Employee');
  });

  it('says an exception is about the data, not the person', () => {
    const caveats = shapeAttendance([row()], filter({ mode: 'exceptions' })).caveats.join(' ');
    expect(caveats).toContain('not that the person did anything wrong');
  });

  it('reports truncation against the real total AND flags the hours as partial', () => {
    const report = shapeAttendance([row({ total_matched: 900 })], filter());
    expect(report.caveats.join(' ')).toContain('900');
    expect(report.caveats.join(' ')).toContain('PARTIAL');
    expect(report.totals.hoursArePartial).toBe(true);
  });

  it('does not flag partial hours when nothing was truncated', () => {
    expect(shapeAttendance([row()], filter()).totals.hoursArePartial).toBe(false);
  });

  it('says an empty result means "not recorded", not "did not work"', () => {
    const caveats = shapeAttendance([], filter()).caveats.join(' ');
    expect(caveats).toContain('not that nobody worked');
    expect(caveats).toContain('2026-07-13');
  });

  it('says when the caller is seeing only their own supervised staff', () => {
    const caveats = shapeAttendance([row()], filter(), { kind: 'scoped', staffCount: 3 }).caveats.join(' ');
    expect(caveats).toContain('NOT the whole organisation');
    expect(caveats).toContain('3');
  });

  it('does not add a scope caveat for an org-wide caller', () => {
    const caveats = shapeAttendance([row()], filter(), { kind: 'orgwide' }).caveats.join(' ');
    expect(caveats).not.toContain('NOT the whole organisation');
  });

  it('counts distinct people, not rows', () => {
    const report = shapeAttendance(
      [row({ staff_id: 's1' }), row({ staff_id: 's1' }), row({ staff_id: 's2' })],
      filter(),
    );
    expect(report.totals.daysShown).toBe(3);
    expect(report.totals.peopleShown).toBe(2);
  });

  it('sums hours across the returned days', () => {
    const report = shapeAttendance([row(), row()], filter());
    expect(report.totals.regularHoursShown).toBe(16);
    expect(report.totals.overtimeHoursShown).toBe(3);
  });

  it('returns null totals rather than 0 when nothing has hours', () => {
    const report = shapeAttendance([row({ regular_hrs: null, overtime_hrs: null })], filter());
    expect(report.totals.regularHoursShown).toBeNull();
  });

  it('carries every exception on a day, not just the first', () => {
    const day = shapeAttendance(
      [row({ exceptions: [{ kind: 'missing_clock_in', status: 'awaiting_supervisor' }, { kind: 'late_arrival', status: 'cancelled' }] })],
      filter(),
    ).days[0];
    expect(day.exceptions).toHaveLength(2);
  });
});
