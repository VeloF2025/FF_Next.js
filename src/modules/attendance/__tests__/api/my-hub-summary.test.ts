import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  findOpenEntry: vi.fn(),
  findActiveVehicleAssignment: vi.fn(),
  sastWorkDate: vi.fn(() => '2026-08-01'),
  countOwnAdjustmentsByStatus: vi.fn(),
  findLatestPayslipForStaff: vi.fn(),
  findLatestReceiptForStaff: vi.fn(),
  findRequiredAttendanceAction: vi.fn(),
}));

// `query`/`queryOne` are needed even though this endpoint only uses `sql` directly: the hub's
// Fleet-incident counts import listDriverIncidents, which reaches driverInputRepository and
// its `query` import. Mocking a module replaces it wholesale, so an omitted export breaks
// every transitive consumer, not just this file's own calls.
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql, query: mocks.query, queryOne: mocks.queryOne }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (
      handler: (
        req: NextApiRequest,
        res: NextApiResponse,
        session: { staffId: string }
      ) => unknown
    ) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, { staffId: 'staff-1' }),
}));
vi.mock('@/modules/attendance/portal/clockUtils', () => ({
  findOpenEntry: mocks.findOpenEntry,
  findActiveVehicleAssignment: mocks.findActiveVehicleAssignment,
  sastWorkDate: mocks.sastWorkDate,
}));
vi.mock('@/modules/attendance/corrections/queries', () => ({
  countOwnAdjustmentsByStatus: mocks.countOwnAdjustmentsByStatus,
}));
vi.mock('@/modules/payslips/queries', () => ({
  findLatestPayslipForStaff: mocks.findLatestPayslipForStaff,
}));
vi.mock('@/modules/receipts/queries', () => ({
  findLatestReceiptForStaff: mocks.findLatestReceiptForStaff,
}));
vi.mock('@/modules/attendance/workflow/requiredActionQueries', () => ({
  findRequiredAttendanceAction: mocks.findRequiredAttendanceAction,
}));

import handler from '../../../../../pages/api/my/hub-summary';

function makeRes(): {
  res: NextApiResponse;
  captured: { status: number; body?: unknown };
} {
  const captured: { status: number; body?: unknown } = { status: 200 };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
    setHeader() {},
  };
  return { res: res as unknown as NextApiResponse, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findOpenEntry.mockResolvedValue(null);
  mocks.findActiveVehicleAssignment.mockResolvedValue({
    id: 'assignment-1',
    vehicle_registration: 'ABC 123 GP',
  });
  mocks.countOwnAdjustmentsByStatus.mockResolvedValue({ pending: 0 });
  mocks.findLatestPayslipForStaff.mockResolvedValue(null);
  mocks.findLatestReceiptForStaff.mockResolvedValue(null);
  mocks.findRequiredAttendanceAction.mockResolvedValue(null);
  mocks.sql
    .mockResolvedValueOnce([{ count: '3' }])
    .mockResolvedValueOnce([
      { vehicle_id: 'vehicle-1', required_check_type: 'weekly' },
    ]);
});

describe('GET /api/my/hub-summary check reminders', () => {
  it('returns the persisted required attendance action', async () => {
    mocks.findRequiredAttendanceAction.mockResolvedValue({
      exceptionId: 'exception-1',
      entryId: 'entry-1',
      workDate: '2026-07-31',
      kind: 'missing_clock_out',
      provisionalPaidHours: 8,
      clockInAt: '2026-07-31T06:00:00.000Z',
    });
    const { res, captured } = makeRes();

    await handler(
      { method: 'GET', query: {}, headers: {} } as NextApiRequest,
      res
    );

    expect(captured.body).toMatchObject({
      success: true,
      data: {
        requiredAttendanceAction: {
          exceptionId: 'exception-1',
          kind: 'missing_clock_out',
          provisionalPaidHours: 8,
        },
      },
    });
  });

  it('returns the assigned vehicle and its due weekly check', async () => {
    const { res, captured } = makeRes();
    await handler(
      { method: 'GET', query: {}, headers: {} } as NextApiRequest,
      res
    );

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      success: true,
      data: {
        assignedVehicle: {
          id: 'assignment-1',
          vehicleId: 'vehicle-1',
          registration: 'ABC 123 GP',
          checkStatusAvailable: true,
          requiredCheckType: 'weekly',
        },
      },
    });
  });

  it('does not query fleet check schedules for staff without a vehicle', async () => {
    vi.clearAllMocks();
    mocks.findOpenEntry.mockResolvedValue(null);
    mocks.findActiveVehicleAssignment.mockResolvedValue(null);
    mocks.countOwnAdjustmentsByStatus.mockResolvedValue({ pending: 0 });
    mocks.findLatestPayslipForStaff.mockResolvedValue(null);
    mocks.findLatestReceiptForStaff.mockResolvedValue(null);
    mocks.findRequiredAttendanceAction.mockResolvedValue(null);
    mocks.sql.mockResolvedValueOnce([{ count: '0' }]);

    const { res, captured } = makeRes();
    await handler(
      { method: 'GET', query: {}, headers: {} } as NextApiRequest,
      res
    );

    expect(captured.body).toMatchObject({
      success: true,
      data: { assignedVehicle: null },
    });
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it('marks vehicle check status unavailable when the schedule lookup fails', async () => {
    mocks.sql.mockReset();
    mocks.sql
      .mockResolvedValueOnce([{ count: '3' }])
      .mockRejectedValueOnce(new Error('schedule unavailable'));

    const { res, captured } = makeRes();
    await handler(
      { method: 'GET', query: {}, headers: {} } as NextApiRequest,
      res
    );

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      success: true,
      data: {
        assignedVehicle: {
          id: 'assignment-1',
          registration: 'ABC 123 GP',
          checkStatusAvailable: false,
          requiredCheckType: null,
        },
      },
    });
  });

  it('marks status unavailable when an assignment has no active fleet vehicle', async () => {
    mocks.sql.mockReset();
    mocks.sql
      .mockResolvedValueOnce([{ count: '3' }])
      .mockResolvedValueOnce([]);

    const { res, captured } = makeRes();
    await handler(
      { method: 'GET', query: {}, headers: {} } as NextApiRequest,
      res
    );

    expect(captured.body).toMatchObject({
      success: true,
      data: {
        assignedVehicle: {
          id: 'assignment-1',
          checkStatusAvailable: false,
          requiredCheckType: null,
        },
      },
    });
  });
});
