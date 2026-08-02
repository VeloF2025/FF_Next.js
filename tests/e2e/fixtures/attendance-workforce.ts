import { isDeepStrictEqual } from 'node:util';
import type { Page } from '@playwright/test';

import {
  ATTENDANCE_IDS, FIXED_API_META, WEEK, WORKER, action, authUser,
  currentAttendance, hints, lockRow, readiness, session, type FixtureRole,
} from './attendance-workforce-data';

export { ATTENDANCE_IDS, FIXED_API_META, WORKER } from './attendance-workforce-data';

type Json = Record<string, unknown>;
type RequestRecord = { method: string; path: string; body: Json | null; status: number; response: unknown };
type ServerEntry = { id: string; status: 'open' | 'closed'; clockInAt: string; clockOutAt: string | null };

const CLOCK_IN_AT = '2026-08-04T06:00:00.000Z';
const CLOCK_OUT_AT = '2026-08-04T15:00:00.000Z';
const DEVICE_FP = '0123456789abcdef0123456789abcdef';

function classificationHours(classification: string) {
  const leave = classification === 'approved_leave' || classification === 'sick_leave';
  const closure = classification === 'site_shutdown_weather';
  const holiday = classification === 'public_holiday';
  return { regular: closure ? 8 : 0, overtime: 0, sunday: 0, holiday: holiday ? 8 : 0,
    leave: leave ? 8 : 0, unpaid: classification === 'unauthorised_absence' ? 8 : 0 };
}

function exactClockBody(body: Json | null, occurredAt: string): boolean {
  if (!body || !isDeepStrictEqual(Object.keys(body).sort(), [
    'accuracy_m', 'client_occurred_at', 'device_fingerprint', 'lat', 'lon', 'selfie_base64',
  ])) return false;
  return body.lat === -26.2041 && body.lon === 28.0473 && body.accuracy_m === 25
    && body.client_occurred_at === occurredAt && body.device_fingerprint === DEVICE_FP
    && typeof body.selfie_base64 === 'string' && body.selfie_base64.length >= 100;
}

export async function installAttendanceWorkforceFixture(page: Page) {
  const actionHistory = new Map<string, ReturnType<typeof action>>();
  const state = {
    current: currentAttendance('weekday'), queue: [action()], ready: false,
    lock: null as Record<string, unknown> | null, actorRole: 'admin' as FixtureRole,
    mutations: [] as Array<{ path: string; body: Json }>, requests: [] as RequestRecord[],
    queueFailure: null as string | null, reviewStale: false, unexpected: [] as string[],
    currentOffline: false,
    reportRows: [{ staff_name: WORKER.name, blocked_days: 0, approved_regular_hours: 48 }],
    serverEntry: null as ServerEntry | null,
    completedDay: null as null | { staffId: string; workDate: string; resultStatus: 'complete';
      recordedElapsedHours: number; proposedRegularHours: number },
  };
  state.queue.forEach((item) => actionHistory.set(item.id, item));

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let body: Json | null = null;
    if (request.postData()) body = request.postDataJSON() as Json;
    const record = (status: number, response: unknown) => {
      state.requests.push({ method, path: url.pathname, body, status, response });
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) });
    };
    const ok = (data: unknown, status = 200) => record(status, { success: true, data, meta: FIXED_API_META });
    const fail = (status: number, code: string, message: string, details?: Json) => record(status, {
      success: false, error: { code, message, ...(details ? { details } : {}) }, meta: FIXED_API_META,
    });
    const rejectBody = (label: string) => {
      state.unexpected.push(`${method} ${url.pathname}: ${label}`);
      return fail(400, 'BAD_REQUEST', label);
    };

    if (url.pathname === '/api/auth/me') return ok({ user: authUser(state.actorRole) });
    if (url.pathname === '/api/tracking/page-visit') return ok({ recorded: true });
    if (url.pathname === '/api/user-sidebar-preferences') return ok({});
    if (url.pathname === '/api/notifications/unread-count') return ok(0);
    if (url.pathname === '/api/notifications') return ok([]);
    if (url.pathname === '/api/chat/access') return record(200, { dataAccess: false });
    if (url.pathname === '/api/dashboard/pinned-links') return ok({ pins: [] });
    if (url.pathname === '/api/my/session') return ok(session);
    if (url.pathname === '/api/my/geocode') return ok({ geocode: { city: 'Midrand', municipalDistrict: 'Johannesburg', province: 'Gauteng' }, cached: true });
    if (url.pathname === '/api/my/attendance/current') {
      if (state.currentOffline) return route.abort('internetdisconnected');
      return ok(state.current);
    }
    if (url.pathname === '/api/my/attendance-corrections-hints') return ok({ hints });
    if (url.pathname === '/api/my/attendance/history') return ok({ entries: [{ entryId: ATTENDANCE_IDS.entry,
      workDate: '2026-08-03', clockInAt: '2026-08-03T06:00:00.000Z', clockOutAt: null,
      status: 'auto_closed', siteGeofenceId: null, vehicleAssignmentId: null,
      selfieInUrl: null, selfieOutUrl: null, durationMs: null }], limit: 30 });

    if (url.pathname === '/api/my/attendance-corrections' && method === 'GET') {
      return ok({ correctionTarget: { exceptionId: url.searchParams.get('exception_id'), entryId: ATTENDANCE_IDS.entry } });
    }
    if (url.pathname === '/api/my/attendance-corrections' && method === 'POST') {
      const expected = { entry_id: ATTENDANCE_IDS.entry, exception_id: ATTENDANCE_IDS.exception,
        adjustment_kind: 'forgot_clock_out', adjusted_clock_in_at: null,
        adjusted_clock_out_at: '2026-08-03T15:00:00.000Z', adjusted_site_geofence_id: null,
        reason: 'Forgot during site close and vehicle handover' };
      if (!isDeepStrictEqual(body, expected)) return rejectBody('Exact correction payload mismatch');
      state.mutations.push({ path: url.pathname, body: body! });
      state.current = { ...state.current, requiredAttendanceAction: null,
        result: { ...state.current.result, status: 'awaiting_supervisor' } };
      actionHistory.set(ATTENDANCE_IDS.exception, action());
      return ok({ adjustmentId: ATTENDANCE_IDS.adjustment, exceptionId: ATTENDANCE_IDS.exception,
        decisionEventId: ATTENDANCE_IDS.decision, exceptionStatus: 'awaiting_supervisor' });
    }

    if (url.pathname === '/api/staff/attendance-day-exceptions' && method === 'GET') {
      if (state.queueFailure) return fail(503, 'SERVICE_UNAVAILABLE', state.queueFailure);
      const status = url.searchParams.get('status') ?? 'unresolved';
      const unresolved = new Set(['open', 'awaiting_worker', 'awaiting_supervisor']);
      const items = status === 'all' ? state.queue : state.queue.filter((item) => unresolved.has(item.status));
      return ok({ items, limit: status === 'all' ? 200 : 50, status,
        scope: { kind: 'scoped', staffCount: 1 } });
    }
    if (url.pathname === '/api/staff/attendance-day-exceptions-review' && method === 'POST') {
      const source = state.queue.find((row) => row.id === body?.exception_id);
      const base = { exception_id: source?.id, expected_result_version: source?.resultVersion,
        action: body?.action, reason: body?.reason };
      const expected = body?.action === 'approve' ? { ...base, approved_hours: source?.dailyResult.proposedHours }
        : body?.action === 'classify' ? { ...base, classification: body?.classification } : base;
      if (!source || !isDeepStrictEqual(body, expected) || typeof body.reason !== 'string' || !body.reason.trim()) {
        return rejectBody('Exact attendance decision payload mismatch');
      }
      if (state.reviewStale) {
        state.reviewStale = false;
        return fail(409, 'CONFLICT', 'Attendance result changed; reload before deciding', { reason: 'result_stale' });
      }
      const classification = body.action === 'classify' ? String(body.classification) : null;
      const approvedHours = body.action === 'return' ? null : body.action === 'classify'
        ? classificationHours(classification) : source.dailyResult.proposedHours;
      const next = { ...source, status: body.action === 'return' ? 'awaiting_worker' : 'resolved',
        permittedActions: [], resultVersion: 5,
        adjustment: source.adjustment ? { ...source.adjustment, status: body.action === 'return' ? 'rejected' : 'approved' } : null,
        dailyResult: { ...source.dailyResult, status: body.action === 'return' ? 'awaiting_worker' : 'approved',
          approvedHours, attendanceClassification: classification,
          blockingReasons: body.action === 'return' ? source.dailyResult.blockingReasons : [] } };
      state.queue = state.queue.map((row) => row.id === source.id ? next : row);
      actionHistory.set(next.id, next);
      state.mutations.push({ path: url.pathname, body: body! });
      return ok({ exception: { id: next.id, status: next.status, resultVersion: 5,
        classification, resolutionReason: body.reason }, dailyResult: { staffId: next.staffId,
        workDate: next.workDate, status: next.dailyResult.status, resultVersion: 5,
        approvedHours, attendanceClassification: classification }, decisionEventId: ATTENDANCE_IDS.decision });
    }

    if (url.pathname === '/api/staff/attendance-period-readiness') return ok(readiness(state.ready));
    if (url.pathname === '/api/staff/attendance-weekly-locks' && method === 'GET') return ok({ lock: state.lock });
    if (url.pathname === '/api/staff/attendance-weekly-locks' && method === 'POST') {
      const expected = body?.action === 'lock'
        ? { week_start_date: WEEK, action: 'lock', lock_reason: body.lock_reason }
        : { week_start_date: WEEK, action: 'unlock', unlock_reason: body?.unlock_reason };
      if (!isDeepStrictEqual(body, expected)) return rejectBody('Exact weekly lock payload mismatch');
      if (state.actorRole === 'site_supervisor') {
        return fail(403, 'FORBIDDEN', 'Attendance lock authority is restricted to HR administrators');
      }
      const version = Number(state.lock?.lock_version ?? 0) + 1;
      state.lock = body.action === 'lock' ? lockRow(version, String(body.lock_reason)) : {
        ...lockRow(version, String(body.unlock_reason)), unlocked_at: FIXED_API_META.timestamp,
        unlocked_by: ATTENDANCE_IDS.admin, unlock_reason: body.unlock_reason, latest_action: 'unlock',
      };
      state.mutations.push({ path: url.pathname, body: body! });
      return ok({ lock: { weekStartDate: WEEK, version, active: body.action === 'lock',
        lockedAt: '2026-08-10T07:00:00.000Z', lockedBy: ATTENDANCE_IDS.admin,
        lockReason: body.lock_reason ?? null, unlockedAt: body.action === 'unlock' ? FIXED_API_META.timestamp : null,
        unlockedBy: body.action === 'unlock' ? ATTENDANCE_IDS.admin : null,
        unlockReason: body.unlock_reason ?? null } });
    }

    if (url.pathname === '/api/my/attendance/clock-in' && method === 'POST') {
      if (!exactClockBody(body, CLOCK_IN_AT)) return rejectBody('Exact clock-in payload mismatch');
      if (state.serverEntry?.status === 'open') return fail(409, 'CONFLICT',
        'You already have an open attendance entry. Close it before clocking in again.', {
          reason: 'open_entry', openEntryId: state.serverEntry.id, openedAt: state.serverEntry.clockInAt,
        });
      state.serverEntry = { id: ATTENDANCE_IDS.entry, status: 'open', clockInAt: CLOCK_IN_AT, clockOutAt: null };
      state.mutations.push({ path: url.pathname, body: body! });
      return ok({ entryId: ATTENDANCE_IDS.entry, workDate: '2026-08-04', clockInAt: CLOCK_IN_AT,
        siteId: ATTENDANCE_IDS.site, siteName: 'Midrand Core', insideSite: true,
        vehicleAssignmentId: null, selfieUrl: '/storage/attendance/controlled-in.jpg' });
    }
    if (url.pathname === '/api/my/attendance/clock-out' && method === 'POST') {
      if (!exactClockBody(body, CLOCK_OUT_AT)) return rejectBody('Exact clock-out payload mismatch');
      if (!state.serverEntry || state.serverEntry.status !== 'open') {
        return fail(404, 'NOT_FOUND', 'No open attendance entry found', { reason: 'no_open_entry' });
      }
      state.serverEntry = { ...state.serverEntry, status: 'closed', clockOutAt: CLOCK_OUT_AT };
      state.completedDay = { staffId: WORKER.staffId, workDate: '2026-08-04',
        resultStatus: 'complete', recordedElapsedHours: 9, proposedRegularHours: 8 };
      state.mutations.push({ path: url.pathname, body: body! });
      return ok({ entryId: ATTENDANCE_IDS.entry, clockInAt: CLOCK_IN_AT, clockOutAt: CLOCK_OUT_AT,
        workDate: '2026-08-04', durationMs: 32_400_000,
        selfieUrl: '/storage/attendance/controlled-out.jpg' });
    }

    if (url.pathname === '/api/staff/attendance-week') return ok({ weekStart: WEEK, weekEnd: '2026-08-09', staff: [],
      totals: { regularHrs: 48, overtimeHrs: 0, sundayHrs: 0, holidayHrs: 0, nightHrs: 0, exceptionsCount: 0, staffCount: 1 },
      payrollTotals: {
        regularHrs: 48,
        overtimeHrs: 0,
        sundayHrs: 0,
        holidayHrs: 0,
        leaveHrs: 0,
        unpaidHrs: 0,
      },
      lock: state.lock?.latest_action === 'lock' && state.lock.unlocked_at === null ? {
        version: Number(state.lock.lock_version),
        lockedAt: String(state.lock.locked_at),
        lockedBy: String(state.lock.locked_by),
        reason: typeof state.lock.lock_reason === 'string' ? state.lock.lock_reason : null,
      } : null,
    });
    if (url.pathname === '/api/staff/attendance-export') return route.fulfill({ status: 200, contentType: 'text/csv', body: 'staff_id,regular_hours\n11111111-1111-4111-8111-111111111111,48\n' });
    if (url.pathname === '/api/staff/attendance-report') return ok({ slug: url.searchParams.get('slug'), rows: state.reportRows,
      columns: [{ key: 'staff_name', label: 'Staff' }, { key: 'blocked_days', label: 'Blocked days', format: 'integer' },
        { key: 'approved_regular_hours', label: 'Approved regular', format: 'number' }],
      notes: ['Controlled browser fixture'], scopeNote: { kind: 'scoped', staffCount: 1 } });
    if (url.pathname === '/api/staff/attendance-report-export') return route.fulfill({ status: 200, contentType: 'text/csv', body: 'staff_name,blocked_days,approved_regular_hours\nJane Worker,0,48\n' });

    state.unexpected.push(`${method} ${url.pathname}${url.search}`);
    return fail(418, 'UNEXPECTED_FIXTURE_REQUEST', 'Unexpected controlled fixture request');
  });

  return {
    state,
    request: (method: string, path: string) => state.requests.filter((row) => row.method === method && row.path === path).at(-1),
    readServerEntry: () => state.serverEntry,
    readCompletedDay: () => state.completedDay,
    seedServerOpenEntry: () => { state.serverEntry = { id: ATTENDANCE_IDS.entry, status: 'open', clockInAt: CLOCK_IN_AT, clockOutAt: null }; },
    readAction: (id: string) => actionHistory.get(id),
    setActorRole: (role: FixtureRole) => { state.actorRole = role; },
    setDay: (day: 'weekday' | 'saturday' | 'sunday' | 'missing-weekend') => { state.current = currentAttendance(day); },
    seedMissingClockOut: ({ paidCapHours }: { paidCapHours: number }) => {
      state.current = currentAttendance(paidCapHours === 8 ? 'missing-weekday' : 'missing-weekend');
      state.queue = [action()]; state.queue.forEach((item) => actionHistory.set(item.id, item));
    },
    seedActions: (kinds: string[]) => { state.queue = kinds.map((kind) => action(kind)); state.queue.forEach((item) => actionHistory.set(item.id, item)); },
    setQueueFailure: (message: string | null) => { state.queueFailure = message; },
    setCurrentOffline: (value: boolean) => { state.currentOffline = value; },
    makeNextReviewStale: () => { state.reviewStale = true; },
    setReady: (value: boolean) => { state.ready = value; },
    readAttendanceState: (staffId: string, workDate: string) => staffId === WORKER.staffId && workDate === '2026-08-03'
      ? { resultStatus: state.current.result.status, adjustmentStatus: 'pending', proposedRegularHours: 8 } : undefined,
  };
}
