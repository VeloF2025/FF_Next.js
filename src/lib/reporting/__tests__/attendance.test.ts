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
    const { sql } = attendanceQuery(filter(mode === 'roster' ? { mode, since: '2026-08-01' } : { mode }));
    for (const column of FORBIDDEN) {
      expect(sql).not.toContain(column);
    }
  });

  it('does not even read the entries table, where those columns live', () => {
    const { sql } = attendanceQuery(filter());
    expect(sql).not.toContain('attendance_entries');
  });
});

describe('attendanceQuery', () => {
  it('binds every user value rather than interpolating it', () => {
    const nasty = "' OR 1=1 --";
    const { sql, params } = attendanceQuery(filter({ person: nasty, since: '2026-01-01' }));
    expect(sql).not.toContain('1=1');
    expect(params.some((p) => String(p).includes('1=1'))).toBe(true);
  });

  it('escapes LIKE metacharacters so a bare % matches nothing', () => {
    const { params } = attendanceQuery(filter({ person: '%' }));
    expect(params).toContain('%\\%%');
  });

  it('reads exceptions from the day-level table, not the entry-level one', () => {
    // attendance_exceptions is entry-level detection data keyed on entry_id and is a
    // different table with a confusingly similar name.
    const { sql } = attendanceQuery(filter({ mode: 'exceptions' }));
    expect(sql).toContain('attendance_day_exceptions');
    expect(sql).not.toMatch(/FROM attendance_exceptions\b/);
  });

  it('aggregates exceptions per day rather than joining rows', () => {
    // 154 live days carry two exceptions; a plain join would duplicate those summaries
    // and double-count their hours.
    const { sql } = attendanceQuery(filter());
    expect(sql).toContain('jsonb_agg');
  });

  it('anchors exceptions mode on the exceptions table, not on summaries', () => {
    // 53 live exception-days have no summary row. Anchoring on summaries hid them, which
    // silently made include_resolved a no-op.
    const { sql } = attendanceQuery(filter({ mode: 'exceptions' }));
    const from = sql.slice(sql.indexOf('FROM'));
    expect(from.indexOf('attendance_day_exceptions')).toBeLessThan(from.indexOf('attendance_daily_summaries'));
  });

  it('applies the unresolved filter only when resolved ones are not wanted', () => {
    expect(attendanceQuery(filter({ mode: 'exceptions' })).sql).toContain('x.has_unresolved');
    expect(
      attendanceQuery(filter({ mode: 'exceptions', includeResolved: 'true' })).sql,
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

  it('reports truncation against the real total', () => {
    const caveats = shapeAttendance([row({ total_matched: 900 })], filter()).caveats.join(' ');
    expect(caveats).toContain('900');
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
    expect(report.totals.regularHours).toBe(16);
    expect(report.totals.overtimeHours).toBe(3);
  });

  it('returns null totals rather than 0 when nothing has hours', () => {
    const report = shapeAttendance([row({ regular_hrs: null, overtime_hrs: null })], filter());
    expect(report.totals.regularHours).toBeNull();
  });

  it('carries every exception on a day, not just the first', () => {
    const day = shapeAttendance(
      [row({ exceptions: [{ kind: 'missing_clock_in', status: 'awaiting_supervisor' }, { kind: 'late_arrival', status: 'cancelled' }] })],
      filter(),
    ).days[0];
    expect(day.exceptions).toHaveLength(2);
  });
});
