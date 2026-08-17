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
  morning?: Record<string, unknown>[];
  clockout?: Record<string, unknown>[];
  staffUsers?: Record<string, Record<string, unknown>[]>;
  staffUserErrors?: string[];
  supervisors?: Record<string, unknown>[];
  morningSupervisorCounts?: Record<string, number>;
  supervisorDigestCounts?: Record<string, Record<string, number>>;
  admins?: Record<string, unknown>[];
}

function installDb(fixture: DbFixture = {}) {
  const claims = new Set<string>();
  const statuses = new Map<string, string>();
  const sql: string[] = [];
  const order: string[] = [];
  mocks.query.mockImplementation(async (text: string, params: unknown[] = []) => {
    sql.push(text);
    if (text.includes('attendance-notifications:morning-candidates')) return fixture.morning ?? [];
    if (text.includes('attendance-notifications:clockout-candidates')) return fixture.clockout ?? [];
    if (text.includes('attendance-notifications:staff-user')) {
      if (fixture.staffUserErrors?.includes(String(params[0]))) throw new Error('recipient read failed');
      return fixture.staffUsers?.[String(params[0])] ?? [];
    }
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
      order.push(`claim:${key}`);
      if (claims.has(key)) return [];
      claims.add(key);
      statuses.set(key, 'claimed');
      return [{ delivery_key: key }];
    }
    if (/UPDATE attendance_notification_dispatches/i.test(text)) {
      statuses.set(String(params[0]), String(params[1]));
      return [{ delivery_key: String(params[0]) }];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  mocks.notify.mockImplementation((payload: { event_type: string; recipient_user_ids?: string[] }) => {
    order.push(`notify:${payload.event_type}`);
    // The bus reports per-recipient delivery; dispatch only marks a notification
    // `accepted` when at least one recipient landed (#2506).
    const recipients = payload.recipient_user_ids?.length ?? 1;
    return Promise.resolve({ recipients, delivered: recipients, failed: 0 });
  });
  return { claims, statuses, sql, order };
}

const ACTIVE_USER = { id: '10000000-0000-4000-8000-000000000001', is_active: true,
  staff_is_active: true, end_date: null };
const STAFF = '20000000-0000-4000-8000-000000000001';
const EXCEPTION = '30000000-0000-4000-8000-000000000001';
const ENTRY = '40000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readiness.mockResolvedValue({
    weekStartDate: '2026-08-03', expectedDayCount: 6, approvedDayCount: 4,
    blockerCount: 2, readyToLock: false, reconciliationFresh: true,
  });
});

describe('worker attendance notifications', () => {
  it('claims once before one clock-out bus invocation under concurrent runs', async () => {
    const state = installDb({
      clockout: [{ entry_id: ENTRY, staff_id: STAFF, work_date: '2026-08-03' }],
      staffUsers: { [STAFF]: [ACTIVE_USER] },
    });

    const now = new Date('2026-08-03T15:00:00.000Z');
    const [left, right] = await Promise.all([
      runAttendanceNotifications({ phase: 'clockout', now }),
      runAttendanceNotifications({ phase: 'clockout', now }),
    ]);

    const key = `attendance:clockout:${ACTIVE_USER.id}:2026-08-03`;
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'attendance.clockout_due', action_url: '/my/attendance',
      source_module: 'attendance', source_id: ENTRY, recipient_user_ids: [ACTIVE_USER.id],
    }));
    expect(state.claims).toEqual(new Set([key]));
    expect(state.statuses.get(key)).toBe('accepted');
    expect(state.order.indexOf(`claim:${key}`)).toBeLessThan(state.order.indexOf('notify:attendance.clockout_due'));
    const claimSql = state.sql.find((text) => /INSERT INTO attendance_notification_dispatches/i.test(text));
    expect(claimSql).toMatch(/ON CONFLICT \(delivery_key\) DO NOTHING/i);
    expect(claimSql).toMatch(/RETURNING delivery_key/i);
    expect(left.accepted + right.accepted).toBe(1);
    expect(left.skipped + right.skipped).toBe(1);
  });

  it('uses the exact correction URL and exception version in the delivery key', async () => {
    const state = installDb({
      morning: [{ exception_id: EXCEPTION, staff_id: STAFF, work_date: '2026-08-03', result_version: 7,
        kind: 'missing_clock_out' }],
      staffUsers: { [STAFF]: [ACTIVE_USER] },
    });

    const first = await runAttendanceNotifications({ phase: 'morning', now: new Date('2026-08-03T06:15:00Z') });
    const second = await runAttendanceNotifications({ phase: 'morning', now: new Date('2026-08-03T06:16:00Z') });

    expect(first).toMatchObject({ examined: 1, claimed: 1, accepted: 1, failed: 0, skipped: 0 });
    expect(second).toMatchObject({ examined: 1, claimed: 0, accepted: 0, failed: 0, skipped: 1 });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'attendance.correction_required',
      action_url: `/my/attendance/corrections/new?exception_id=${EXCEPTION}`,
      source_id: EXCEPTION,
    }));
    expect([...state.claims]).toEqual([
      `attendance:correction:${ACTIVE_USER.id}:2026-08-03:${EXCEPTION}:v7`,
    ]);
  });

  it('allows a newly persisted exception version to notify separately', async () => {
    const fixture: DbFixture = {
      morning: [{ exception_id: EXCEPTION, staff_id: STAFF, work_date: '2026-08-03',
        result_version: 7, kind: 'missing_clock_out' }],
      staffUsers: { [STAFF]: [ACTIVE_USER] },
    };
    const state = installDb(fixture);
    const now = new Date('2026-08-03T06:15:00Z');

    await runAttendanceNotifications({ phase: 'morning', now });
    fixture.morning = [{ ...fixture.morning![0], result_version: 8 }];
    await runAttendanceNotifications({ phase: 'morning', now });

    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect([...state.claims]).toEqual([
      `attendance:correction:${ACTIVE_USER.id}:2026-08-03:${EXCEPTION}:v7`,
      `attendance:correction:${ACTIVE_USER.id}:2026-08-03:${EXCEPTION}:v8`,
    ]);
  });

  it('isolates missing, ambiguous and inactive links while notifying a valid worker', async () => {
    const missing = '20000000-0000-4000-8000-000000000002';
    const ambiguous = '20000000-0000-4000-8000-000000000003';
    const inactive = '20000000-0000-4000-8000-000000000004';
    installDb({
      morning: [STAFF, missing, ambiguous, inactive].map((staff_id, index) => ({
        exception_id: `30000000-0000-4000-8000-00000000000${index + 1}`,
        staff_id, work_date: '2026-08-03', result_version: 1, kind: 'missing_clock_out',
      })),
      staffUsers: {
        [STAFF]: [ACTIVE_USER], [missing]: [],
        [ambiguous]: [ACTIVE_USER, { ...ACTIVE_USER, id: '10000000-0000-4000-8000-000000000002' }],
        [inactive]: [{ ...ACTIVE_USER, id: '10000000-0000-4000-8000-000000000003', is_active: false }],
      },
    });

    const report = await runAttendanceNotifications({ phase: 'morning', now: new Date('2026-08-03T06:15:00Z') });

    expect(report).toMatchObject({ examined: 4, claimed: 1, accepted: 1, failed: 3, skipped: 0 });
    expect(report.failures.map((failure) => failure.reason)).toEqual([
      'recipient_missing', 'recipient_ambiguous', 'recipient_inactive',
    ]);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it('marks a synchronous bus invocation failure without claiming delivery', async () => {
    const state = installDb({
      clockout: [{ entry_id: ENTRY, staff_id: STAFF, work_date: '2026-08-03' }],
      staffUsers: { [STAFF]: [ACTIVE_USER] },
    });
    mocks.notify.mockImplementation(() => { throw new Error('bus unavailable'); });

    const report = await runAttendanceNotifications({ phase: 'clockout', now: new Date('2026-08-03T15:00:00Z') });

    expect(report).toMatchObject({ claimed: 1, accepted: 0, failed: 1 });
    expect(report.failures[0]?.reason).toBe('notification_bus_invocation_failed');
    expect(state.statuses.values().next().value).toBe('failed');
  });

  // Inverted from "records accepted for a returned bus promise". That pinned the
  // #2506 bug: a rejecting bus was still recorded `accepted`, burning the
  // idempotency key so a later working run would skip the notification forever.
  it('records failed — not accepted — when the bus rejects', async () => {
    const state = installDb({
      clockout: [{ entry_id: ENTRY, staff_id: STAFF, work_date: '2026-08-03' }],
      staffUsers: { [STAFF]: [ACTIVE_USER] },
    });
    mocks.notify.mockReturnValue(Promise.reject(new Error('downstream channel failed')));

    const report = await runAttendanceNotifications({ phase: 'clockout', now: new Date('2026-08-03T15:00:00Z') });
    await Promise.resolve();

    expect(report).toMatchObject({ claimed: 1, accepted: 0, failed: 1 });
    expect(state.statuses.values().next().value).toBe('failed');
  });

  it('records failed when the bus delivers to nobody', async () => {
    // The production shape of #2506: notify() resolves (it never throws) but
    // every recipient failed, because the bus could not reach the database.
    const state = installDb({
      clockout: [{ entry_id: ENTRY, staff_id: STAFF, work_date: '2026-08-03' }],
      staffUsers: { [STAFF]: [ACTIVE_USER] },
    });
    mocks.notify.mockResolvedValue({ recipients: 1, delivered: 0, failed: 1 });

    const report = await runAttendanceNotifications({ phase: 'clockout', now: new Date('2026-08-03T15:00:00Z') });

    expect(report).toMatchObject({ claimed: 1, accepted: 0, failed: 1 });
    // Left retryable rather than burnt.
    expect(state.statuses.values().next().value).toBe('failed');
  });

  it('isolates a recipient query failure and continues with the next candidate', async () => {
    const broken = '20000000-0000-4000-8000-000000000099';
    installDb({
      morning: [broken, STAFF].map((staff_id, index) => ({
        exception_id: `30000000-0000-4000-8000-00000000009${index}`,
        staff_id, work_date: '2026-08-03', result_version: 1, kind: 'missing_clock_out',
      })),
      staffUserErrors: [broken], staffUsers: { [STAFF]: [ACTIVE_USER] },
    });

    const report = await runAttendanceNotifications({ phase: 'morning', now: new Date('2026-08-03T06:15:00Z') });

    expect(report).toMatchObject({ examined: 2, accepted: 1, failed: 1 });
    expect(report.failures[0]?.reason).toBe('recipient_resolution_failed');
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it('records accepted only when the accepted ledger readback persists', async () => {
    installDb({
      clockout: [{ entry_id: ENTRY, staff_id: STAFF, work_date: '2026-08-03' }],
      staffUsers: { [STAFF]: [ACTIVE_USER] },
    });
    const base = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation((text: string, params: unknown[]) => {
      if (/UPDATE attendance_notification_dispatches/i.test(text) && params[1] === 'accepted') {
        return Promise.reject(new Error('ledger unavailable'));
      }
      return base(text, params);
    });

    const report = await runAttendanceNotifications({ phase: 'clockout', now: new Date('2026-08-03T15:00:00Z') });

    expect(report).toMatchObject({ claimed: 1, accepted: 0, failed: 1 });
    expect(report.failures[0]?.reason).toBe('dispatch_status_update_failed');
  });
});
