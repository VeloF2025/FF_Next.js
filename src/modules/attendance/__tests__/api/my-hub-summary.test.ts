import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  findOpenEntry: vi.fn(),
  findActiveVehicleAssignment: vi.fn(),
  countOwnAdjustmentsByStatus: vi.fn(),
  findLatestPayslipForStaff: vi.fn(),
  findLatestReceiptForStaff: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
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
  mocks.sql
    .mockResolvedValueOnce([{ count: '3' }])
    .mockResolvedValueOnce([
      { vehicle_id: 'vehicle-1', required_check_type: 'weekly' },
    ]);
});

describe('GET /api/my/hub-summary check reminders', () => {
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
});
