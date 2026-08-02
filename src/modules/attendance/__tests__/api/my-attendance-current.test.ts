import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  findOpenEntry: vi.fn(),
  sastWorkDate: vi.fn(() => '2026-08-01'),
  findRequiredAttendanceAction: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (handler: (req: NextApiRequest, res: NextApiResponse, session: { staffId: string }) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) => handler(req, res, { staffId: 'staff-1' }),
}));
vi.mock('@/modules/attendance/portal/clockUtils', () => ({
  findOpenEntry: mocks.findOpenEntry,
  sastWorkDate: mocks.sastWorkDate,
}));
vi.mock('@/modules/attendance/workflow/requiredActionQueries', () => ({
  findRequiredAttendanceAction: mocks.findRequiredAttendanceAction,
}));

import handler from '../../../../../pages/api/my/attendance/current';

function makeRes(): {
  res: NextApiResponse;
  captured: { status: number; body?: unknown };
} {
  const captured: { status: number; body?: unknown } = { status: 200 };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader() {},
  };
  return { res: res as unknown as NextApiResponse, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findOpenEntry.mockResolvedValue(null);
  mocks.findRequiredAttendanceAction.mockResolvedValue({
    exceptionId: 'exception-1',
    entryId: 'entry-1',
    workDate: '2026-07-31',
    kind: 'missing_clock_out',
    provisionalPaidHours: 8,
    clockInAt: '2026-07-31T06:00:00.000Z',
  });
  mocks.sql.mockResolvedValue([{
    policy_id: 'policy-1',
    timezone: 'Africa/Johannesburg',
    schedule_start: '08:00',
    schedule_end: '13:00',
    unpaid_break_minutes: 0,
    scheduled_paid_hours: '5',
    result_status: 'complete',
    recorded_elapsed_hours: '5.25',
    result_scheduled_paid_hours: '5',
  }]);
});

describe('GET /api/my/attendance/current', () => {
  it('returns server-derived schedule, result and required-action state', async () => {
    const { res, captured } = makeRes();

    await handler({ method: 'GET', query: {}, headers: {} } as NextApiRequest, res);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      success: true,
      data: {
        workDate: '2026-08-01',
        open: null,
        schedule: {
          policyId: 'policy-1',
          timezone: 'Africa/Johannesburg',
          start: '08:00',
          end: '13:00',
          unpaidBreakMinutes: 0,
          scheduledPaidHours: 5,
        },
        result: {
          status: 'complete',
          recordedElapsedHours: 5.25,
          scheduledPaidHours: 5,
        },
        requiredAttendanceAction: { exceptionId: 'exception-1' },
      },
    });
  });

  it('returns open as the server result status before a daily projection exists', async () => {
    mocks.findOpenEntry.mockResolvedValue({
      id: 'entry-open',
      work_date: '2026-08-01',
      clock_in_at: '2026-08-01T06:00:00.000Z',
      site_geofence_id: null,
      vehicle_assignment_id: null,
      selfie_in_url: '/storage/in.jpg',
    });
    mocks.findRequiredAttendanceAction.mockResolvedValue(null);
    mocks.sql.mockResolvedValueOnce([{
      policy_id: 'policy-1',
      timezone: 'Africa/Johannesburg',
      schedule_start: '08:00',
      schedule_end: '13:00',
      unpaid_break_minutes: 0,
      scheduled_paid_hours: '5',
      result_status: null,
      recorded_elapsed_hours: null,
      result_scheduled_paid_hours: null,
    }]);
    const { res, captured } = makeRes();

    await handler({ method: 'GET', query: {}, headers: {} } as NextApiRequest, res);

    expect(captured.body).toMatchObject({
      success: true,
      data: { result: { status: 'open', recordedElapsedHours: null, scheduledPaidHours: 5 } },
    });
  });
});
