import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db-pool', () => ({ query: queryMock }));

import {
  loadEffectivePolicy,
  loadExpectedAttendanceDays,
  loadOpenEntriesForReconciliation,
  loadReconciliationEntries,
  type AttendancePolicyReader,
} from '../reconcileQueries';

interface QueryCall {
  text: string;
  params: unknown[];
}

function reader(rows: Record<string, unknown>[]): AttendancePolicyReader & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  return Object.assign(async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    return rows as T[];
  }, { calls });
}

describe('attendance policy reconcile readers', () => {
  beforeEach(() => queryMock.mockReset());

  it('maps the effective fixed SAST policy returned by the production reader query', async () => {
    const db = reader([{
      id: '00000000-0000-0000-0000-000000000001',
      timezone: 'Africa/Johannesburg', weekday_start: '08:00', weekday_end: '17:00',
      weekday_unpaid_break_minutes: 60, weekday_paid_cap_hrs: '8',
      saturday_start: '08:00', saturday_end: '13:00', saturday_paid_cap_hrs: '5',
      sunday_scheduled: false, sunday_missing_out_cap_hrs: '5', late_alert_minutes: 15,
    }]);

    const policy = await loadEffectivePolicy('2026-08-03', db);

    expect(policy).toMatchObject({ id: '00000000-0000-0000-0000-000000000001', timezone: 'Africa/Johannesburg', weekdayPaidCapHours: 8, saturdayPaidCapHours: 5 });
    expect(db.calls[0]?.params).toEqual(['2026-08-03', '2026-08-03']);
  });

  it('returns explicit expected-day date strings in database chronological order', async () => {
    const db = reader([
      { staff_id: 'a', work_date: '2026-08-03', is_public_holiday: false, public_holiday_name: null },
      { staff_id: 'b', work_date: '2026-08-03', is_public_holiday: false, public_holiday_name: null },
      { staff_id: 'a', work_date: '2026-08-04', is_public_holiday: false, public_holiday_name: null },
    ]);

    const days = await loadExpectedAttendanceDays('2026-08-03', '2026-08-04', db);

    expect(days.map((day) => `${day.work_date}:${day.staff_id}`)).toEqual([
      '2026-08-03:a', '2026-08-03:b', '2026-08-04:a',
    ]);
    expect(db.calls[0]?.text).toContain("TO_CHAR(w.work_date, 'YYYY-MM-DD')");
    expect(db.calls[0]?.text).toContain('ORDER BY w.work_date ASC, s.id ASC');
    expect(db.calls[0]?.text).toContain('s.join_date::date <= w.work_date');
    expect(db.calls[0]?.text).toContain('s.end_date::date >= w.work_date');
    expect(db.calls[0]?.text).toContain("LOWER(s.account_status) <> 'pending'");
    expect(db.calls[0]?.text).toContain('s.attendance_tracked = true');
  });

  it('restricts the expectation universe to attendance_tracked staff only', async () => {
    const db = reader([]);

    await loadExpectedAttendanceDays('2026-08-03', '2026-08-04', db);

    expect(db.calls[0]?.text).toContain('s.attendance_tracked = true');
  });

  it('does NOT filter entry-driven readers by attendance_tracked', async () => {
    // The flag governs expectation, not processing. An untracked staff member
    // who clocks in must still be reconciled and paid — filtering here would
    // strip their real hours out of payroll.
    queryMock.mockResolvedValue([]);

    await loadReconciliationEntries('2026-08-03', '2026-08-04');
    await loadOpenEntriesForReconciliation('2026-08-03', '2026-08-04');

    for (const [text] of queryMock.mock.calls as [string, unknown[]][]) {
      expect(text).not.toContain('attendance_tracked');
    }
  });

  it('selects only prior-day open sessions covered by an effective policy', async () => {
    queryMock.mockResolvedValue([]);

    await loadOpenEntriesForReconciliation('2026-08-03', '2026-08-04');

    const [text, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("TO_CHAR(attendance_entries.work_date, 'YYYY-MM-DD')");
    expect(text).toContain("status = 'open'");
    expect(text).toContain("NOW() AT TIME ZONE 'Africa/Johannesburg'");
    expect(text).toContain('FROM attendance_schedule_policies');
    expect(text).toContain('active_from <= attendance_entries.work_date');
    expect(text).toContain('active_to >= attendance_entries.work_date');
    expect(text).toContain('s.join_date::date <= attendance_entries.work_date');
    expect(text).toContain('s.end_date::date >= attendance_entries.work_date');
    expect(text).toContain("LOWER(s.account_status) <> 'pending'");
    expect(text).toMatch(/attendance_adjustments approved_out[\s\S]*adjusted_clock_out_at IS NOT NULL/i);
    expect(params).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('loads entry evidence chronologically with existing fingerprint identity', async () => {
    queryMock.mockResolvedValue([]);

    await loadReconciliationEntries('2026-08-03', '2026-08-04');

    const [text, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("TO_CHAR(e.work_date, 'YYYY-MM-DD')");
    expect(text).toContain('ds.calculation_fingerprint, ds.result_version');
    expect(text).toMatch(/ORDER BY e\.staff_id ASC, e\.work_date ASC,[\s\S]*COALESCE\(approved_adjustment\.adjusted_clock_in_at, e\.clock_in_at\) ASC/i);
    expect(text).toContain('s.join_date::date <= e.work_date');
    expect(text).toContain('s.end_date::date >= e.work_date');
    expect(text).toContain("LOWER(s.account_status) <> 'pending'");
    expect(params).toEqual(['2026-08-03', '2026-08-04']);
  });

  it('overlays the latest approved value per field without mutating raw entry evidence', async () => {
    queryMock.mockResolvedValueOnce([{
      id: 'entry-1', staff_id: 'staff-1', work_date: '2026-08-03',
      clock_in_at: '2026-08-03T06:30:00.000Z', clock_out_at: '2026-08-03T15:00:00.000Z',
      site_geofence_id: 'site-adjusted', status: 'open', bcea_applicable: true,
      ordinarily_works_sundays: false, hourly_rate: null,
      calculation_fingerprint: null, result_version: null,
    }]);

    const rows = await loadReconciliationEntries('2026-08-03', '2026-08-03');
    const [text] = queryMock.mock.calls[0] as [string, unknown[]];

    expect(rows[0]).toMatchObject({
      clock_in_at: '2026-08-03T06:30:00.000Z',
      clock_out_at: '2026-08-03T15:00:00.000Z',
      site_geofence_id: 'site-adjusted',
    });
    expect(text).toMatch(/attendance_adjustments[\s\S]*status = 'approved'/i);
    expect(text).toMatch(/COALESCE\(approved_adjustment\.adjusted_clock_in_at, e\.clock_in_at\)/i);
    expect(text).toMatch(/COALESCE\(approved_adjustment\.adjusted_clock_out_at, e\.clock_out_at\)/i);
    expect(text).toMatch(/COALESCE\(approved_adjustment\.adjusted_site_geofence_id, e\.site_geofence_id\)/i);
    for (const field of [
      'adjusted_clock_in_at', 'adjusted_clock_out_at', 'adjusted_site_geofence_id',
    ]) {
      expect(text).toMatch(new RegExp(`${field} IS NOT NULL[\\s\\S]*?ORDER BY reviewed_at DESC NULLS LAST, updated_at DESC, id DESC`, 'i'));
    }
  });
});
