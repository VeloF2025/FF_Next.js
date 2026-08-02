import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  notify: vi.fn(),
  readiness: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));
vi.mock('@/modules/notifications/services/notificationBus', () => ({ notify: mocks.notify }));
vi.mock('../periodQueries', () => ({ getPeriodReadiness: mocks.readiness }));

import { runAttendanceNotifications } from '../notificationService';

interface DbFixture {
  supervisors?: Record<string, unknown>[];
  morningSupervisorCounts?: Record<string, number>;
  supervisorDigestCounts?: Record<string, Record<string, number>>;
  admins?: Record<string, unknown>[];
}

function installDb(fixture: DbFixture = {}) {
  const claims = new Set<string>();
  const sql: string[] = [];
  mocks.query.mockImplementation(async (text: string, params: unknown[] = []) => {
    sql.push(text);
    if (text.includes('attendance-notifications:morning-candidates')) return [];
    if (text.includes('attendance-notifications:clockout-candidates')) return [];
    if (text.includes('attendance-notifications:supervisor-links')) return fixture.supervisors ?? [];
    if (text.includes('attendance-notifications:supervisor-morning-count')) {
      return [{ total_count: fixture.morningSupervisorCounts?.[String(params[0])] ?? 0 }];
    }
    if (text.includes('attendance-notifications:supervisor-digest-counts')) {
      return [fixture.supervisorDigestCounts?.[String(params[0])] ?? {
        live_open_sessions: 0, sunday_work: 0, overtime: 0,
        unresolved_classifications: 0, outstanding_corrections: 0,
      }];
    }
    if (text.includes('attendance-notifications:admin-recipients')) return fixture.admins ?? [];
    if (/INSERT INTO attendance_notification_dispatches/i.test(text)) {
      const key = String(params[0]);
      if (claims.has(key)) return [];
      claims.add(key);
      return [{ delivery_key: key }];
    }
    if (/UPDATE attendance_notification_dispatches/i.test(text)) {
      return [{ delivery_key: String(params[0]) }];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  mocks.notify.mockReturnValue(Promise.resolve());
  return { claims, sql };
}

const ACTIVE_USER = { id: '10000000-0000-4000-8000-000000000001' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readiness.mockResolvedValue({
    weekStartDate: '2026-08-03', expectedDayCount: 6, approvedDayCount: 4,
    blockerCount: 2, readyToLock: false, reconciliationFresh: true,
  });
});

describe('supervisor and HR notifications', () => {
  it('sends idempotent 08:15 supervisor late/no-clock flags', async () => {
    const supervisor = '10000000-0000-4000-8000-000000000010';
    const supervisorStaff = '20000000-0000-4000-8000-000000000010';
    const state = installDb({
      supervisors: [{ recipient_user_id: supervisor, supervisor_staff_id: supervisorStaff }],
      morningSupervisorCounts: { [supervisorStaff]: 2 },
    });

    const first = await runAttendanceNotifications({ phase: 'morning', now: new Date('2026-08-03T06:15:00Z') });
    const second = await runAttendanceNotifications({ phase: 'morning', now: new Date('2026-08-03T06:16:00Z') });

    expect(first).toMatchObject({ examined: 1, accepted: 1 });
    expect(second).toMatchObject({ examined: 1, skipped: 1 });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'attendance.supervisor_morning_flags',
      body: expect.stringContaining('2 late/no-clock'),
      metadata: expect.objectContaining({ workDate: '2026-08-03', flagCount: 2 }),
      recipient_user_ids: [supervisor],
    }));
    expect([...state.claims]).toEqual([`attendance:morning-supervisor:${supervisor}:2026-08-03`]);
    const countSql = state.sql.find((text) => text.includes('attendance-notifications:supervisor-morning-count')) ?? '';
    expect(countSql).toMatch(/attendance_schedule_policies/i);
    expect(countSql).toMatch(/weekday_start/i);
    expect(countSql).toMatch(/saturday_start/i);
    expect(countSql).toMatch(/first_clock_in IS NULL/i);
    expect(countSql).toMatch(/first_clock_in > \(\$2::date \+ expected\.shift_start\)/i);
    expect(countSql).toMatch(/employee\.join_date::date <= \$2::date/i);
    expect(countSql).toMatch(/employee\.end_date::date >= \$2::date/i);
    expect(countSql).toMatch(/LOWER\(employee\.account_status\) <> 'pending'/i);
    expect(countSql).toMatch(/NOT EXISTS \([\s\S]*FROM public_holidays/i);
    expect(countSql).not.toMatch(/attendance_day_exceptions/i);
    expect(countSql).not.toMatch(/late_alert_minutes/i);
  });

  it('sends a scoped digest covering live opens, Sunday, OT, classifications, and corrections', async () => {
    const supervisor = '10000000-0000-4000-8000-000000000010';
    const supervisorStaff = '20000000-0000-4000-8000-000000000010';
    const state = installDb({
      supervisors: [{ recipient_user_id: supervisor, supervisor_staff_id: supervisorStaff }],
      supervisorDigestCounts: { [supervisorStaff]: {
        live_open_sessions: 2, sunday_work: 3, overtime: 4,
        unresolved_classifications: 5, outstanding_corrections: 1200,
      } },
    });

    const report = await runAttendanceNotifications({ phase: 'digest', now: new Date('2026-08-03T16:00:00Z') });

    expect(report).toMatchObject({ examined: 1, claimed: 1, accepted: 1, failed: 0 });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'attendance.supervisor_digest',
      body: expect.stringContaining('999+'),
      action_url: '/staff/attendance/corrections?status=unresolved',
      metadata: expect.objectContaining({
        liveOpenSessions: 2, sundayWork: 3, overtime: 4,
        unresolvedClassifications: 5, outstandingCorrections: 1200,
      }),
      recipient_user_ids: [supervisor],
    }));
    expect([...state.claims]).toEqual([`attendance:digest:${supervisor}:2026-08-03`]);
    const countSql = state.sql.find((text) => text.includes('attendance-notifications:supervisor-digest-counts')) ?? '';
    expect(countSql).toMatch(/WITH RECURSIVE descendants/i);
    expect(countSql).toMatch(/attendance_entries[\s\S]*clock_out_at IS NULL/i);
    expect(countSql).toMatch(/proposed_sunday_hrs/i);
    expect(countSql).toMatch(/proposed_overtime_hrs/i);
    expect(countSql).toMatch(/attendance_classification/i);
    expect(countSql).toMatch(/attendance_adjustments[\s\S]*status = 'pending'/i);
  });

  it('notifies only active admin roles with authoritative weekly readiness', async () => {
    const admin = '10000000-0000-4000-8000-000000000020';
    const state = installDb({ admins: [{ recipient_user_id: admin, role: 'admin' }] });

    const report = await runAttendanceNotifications({ phase: 'weekly', now: new Date('2026-08-05T20:00:00Z') });

    expect(mocks.readiness).toHaveBeenCalledWith('2026-08-03');
    expect(report).toMatchObject({ examined: 1, claimed: 1, accepted: 1 });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'attendance.hr_readiness',
      action_url: '/staff/attendance/locks?week=2026-08-03', recipient_user_ids: [admin],
      body: expect.stringContaining('4 of 6'),
    }));
    expect([...state.claims]).toEqual([`attendance:weekly:${admin}:2026-08-03`]);
    const adminSql = state.sql.find((text) => text.includes('attendance-notifications:admin-recipients')) ?? '';
    expect(adminSql).toMatch(/u\.role IN \('admin', 'super_admin'\)/i);
    expect(adminSql).toMatch(/u\.is_active = true/i);
    expect(adminSql).not.toMatch(/manager/i);
  });

  it('never writes attendance workflow, approval, lock or export state', async () => {
    const state = installDb({ admins: [{ recipient_user_id: ACTIVE_USER.id, role: 'admin' }] });
    await runAttendanceNotifications({ phase: 'weekly', now: new Date('2026-08-03T06:15:00Z') });
    const writes = state.sql.filter((text) => /^\s*(INSERT|UPDATE|DELETE)/i.test(text));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((text) => /attendance_notification_dispatches/i.test(text))).toBe(true);
  });
});
