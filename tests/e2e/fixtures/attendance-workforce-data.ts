export const ATTENDANCE_IDS = {
  worker: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  session: '33333333-3333-4333-8333-333333333333',
  policy: '44444444-4444-4444-8444-444444444444',
  site: '55555555-5555-4555-8555-555555555555',
  entry: '66666666-6666-4666-8666-666666666666',
  exception: '77777777-7777-4777-8777-777777777777',
  adjustment: '88888888-8888-4888-8888-888888888888',
  decision: '99999999-9999-4999-8999-999999999999',
} as const;

export const FIXED_API_META = { timestamp: '2026-08-10T08:00:00.000Z' } as const;
export const WORKER = { staffId: ATTENDANCE_IDS.worker, name: 'Jane Worker' };
export const WEEK = '2026-08-03';
export const HOURS = {
  regular: 8, overtime: 0, sunday: 0, holiday: 0, leave: 0, unpaid: 0,
};

export type FixtureRole = 'admin' | 'site_supervisor';

export function authUser(role: FixtureRole) {
  return {
    id: ATTENDANCE_IDS.admin, email: `${role}@example.test`, name: role === 'admin' ? 'HR Admin' : 'Site Supervisor',
    role, permissions: role === 'admin' ? ['all'] : ['people.staff.attendance.locks:view'],
  };
}

export const session = {
  session: { sessionId: ATTENDANCE_IDS.session, staffId: WORKER.staffId, method: 'pin', expiresAt: '2026-08-10T10:00:00.000Z' },
  profile: { ...WORKER, phone: null, email: null, homeSiteId: null, hasAssignedVehicle: false,
    profilePhotoUrl: null, role: 'technician', accountStatus: 'active', authRole: null },
};

export const hints = Object.fromEntries(
  ['forgot_clock_out', 'wrong_clock_in_time', 'wrong_clock_out_time', 'wrong_site', 'duplicate_entry', 'other']
    .map((key) => [key, { label: key.replaceAll('_', ' '), placeholder: '', hint: '', minReasonChars: 10 }]),
);

export function action(kind = 'missing_clock_out', status = 'awaiting_supervisor') {
  const unreliable = kind === 'evidence_unreliable';
  const sunday = kind === 'sunday_work';
  const proposed = { ...HOURS, regular: sunday ? 0 : 8, sunday: sunday ? 5 : 0 };
  const permittedActions = status !== 'awaiting_supervisor' ? []
    : kind === 'missing_clock_in' ? ['classify']
      : kind === 'missing_clock_out' ? ['approve', 'return']
        : ['approve'];
  return {
    id: ATTENDANCE_IDS.exception, staffId: WORKER.staffId, staffName: WORKER.name,
    workDate: '2026-08-03', kind, status, permittedActions,
    resultVersion: 4, queueOwnerUserId: null,
    createdAt: '2026-08-04T06:00:00.000Z', crewName: 'Crew Alpha',
    site: { id: ATTENDANCE_IDS.site, name: 'Midrand Core' },
    evidence: {
      entryId: ATTENDANCE_IDS.entry, clockInAt: '2026-08-03T06:00:00.000Z',
      clockOutAt: unreliable || kind !== 'missing_clock_out' ? '2026-08-03T15:00:00.000Z' : null,
      clockInGpsAvailable: unreliable, clockOutGpsAvailable: unreliable,
      selfies: unreliable ? [
        { entryId: ATTENDANCE_IDS.entry, kind: 'in' },
        { entryId: ATTENDANCE_IDS.entry, kind: 'out' },
      ] : [],
    },
    adjustment: kind === 'missing_clock_out' && status === 'awaiting_supervisor' ? {
      id: ATTENDANCE_IDS.adjustment, kind: 'forgot_clock_out', adjustedClockInAt: null,
      adjustedClockOutAt: '2026-08-03T15:00:00.000Z',
      reason: 'Forgot during site close and vehicle handover', status: 'pending',
    } : null,
    proposedHours: proposed,
    dailyResult: {
      status, scheduledPaidHours: 8, recordedElapsedHours: 9, proposedHours: proposed,
      approvedHours: null, attendanceClassification: null, blockingReasons: [kind],
    },
  };
}

export function readiness(ready: boolean) {
  return {
    weekStartDate: WEEK, weekEndDate: '2026-08-09', activeStaffCount: 1, expectedDayCount: 6,
    approvedDayCount: ready ? 6 : 5, blockerCount: ready ? 0 : 1, unapprovedOvertimeHours: 0,
    unapprovedSundayHours: ready ? 0 : 5, reconciliationLastSucceededAt: '2026-08-10T05:00:00.000Z',
    reconciliationFresh: true, readyToLock: ready,
    blockers: ready ? [] : [{ staffId: WORKER.staffId, workDate: '2026-08-09',
      kind: 'awaiting_supervisor', owner: 'supervisor',
      actionUrl: `/staff/attendance/corrections?exception_id=${ATTENDANCE_IDS.exception}`,
      exceptionId: ATTENDANCE_IDS.exception, exceptionKind: 'sunday_work', status: 'awaiting_supervisor' }],
  };
}

export function currentAttendance(day: 'weekday' | 'saturday' | 'sunday' | 'missing-weekday' | 'missing-weekend') {
  const weekend = day === 'saturday' || day === 'missing-weekend';
  const missing = day.startsWith('missing');
  return {
    workDate: weekend ? '2026-08-08' : day === 'sunday' ? '2026-08-09' : '2026-08-04', open: null,
    schedule: { policyId: ATTENDANCE_IDS.policy, timezone: 'Africa/Johannesburg',
      start: day === 'sunday' ? null : '08:00', end: day === 'sunday' ? null : weekend ? '13:00' : '17:00',
      unpaidBreakMinutes: weekend || day === 'sunday' ? 0 : 60,
      scheduledPaidHours: day === 'sunday' ? 0 : weekend ? 5 : 8 },
    result: { status: missing ? 'awaiting_worker' : 'expected', recordedElapsedHours: null,
      scheduledPaidHours: day === 'sunday' ? 0 : weekend ? 5 : 8 },
    requiredAttendanceAction: missing ? { exceptionId: ATTENDANCE_IDS.exception,
      entryId: ATTENDANCE_IDS.entry, workDate: '2026-08-03', kind: 'missing_clock_out',
      provisionalPaidHours: weekend ? 5 : 8, clockInAt: '2026-08-03T06:00:00.000Z' } : null,
  };
}

export function lockRow(version: number, reason: string) {
  return {
    week_start_date: WEEK, locked_at: '2026-08-10T07:00:00.000Z',
    locked_by: ATTENDANCE_IDS.admin, lock_reason: reason, unlocked_at: null, unlocked_by: null,
    unlock_reason: null, lock_version: version, latest_action: 'lock',
    latest_actor_user_id: ATTENDANCE_IDS.admin, latest_reason: reason,
    latest_recorded_at: '2026-08-10T07:00:00.000Z',
  };
}
