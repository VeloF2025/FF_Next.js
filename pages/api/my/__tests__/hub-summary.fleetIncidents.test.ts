import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Focused addition test (PR7 Task 7): only the new `fleetIncidents` counts
 * on `/api/my/hub-summary`. The rest of the handler's existing behavior
 * (openEntry/vehicle/payslip/receipt/etc.) is stubbed out with harmless
 * defaults rather than re-asserted — there is no pre-existing test file
 * for those to extend, and re-testing them is outside this task's scope.
 */
const SESSION = { staffId: '11111111-1111-4111-8111-111111111111', staffName: 'A Driver' };

vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (handler: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, SESSION),
}));

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([{ count: '0' }]),
  findOpenEntry: vi.fn().mockResolvedValue(null),
  findActiveVehicleAssignment: vi.fn().mockResolvedValue(null),
  sastWorkDate: vi.fn().mockReturnValue('2026-08-19'),
  countOwnAdjustmentsByStatus: vi.fn().mockResolvedValue({ pending: 0, approved: 0, rejected: 0, cancelled: 0 }),
  findLatestPayslipForStaff: vi.fn().mockResolvedValue(null),
  findLatestReceiptForStaff: vi.fn().mockResolvedValue(null),
  findRequiredAttendanceAction: vi.fn().mockResolvedValue(null),
  listDriverIncidents: vi.fn().mockResolvedValue({ incidents: [], total: 0, recentWindowDays: 90, historyWindowDays: 365 }),
  logWarn: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ log: { warn: mocks.logWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/modules/attendance/portal/clockUtils', () => ({
  findOpenEntry: mocks.findOpenEntry, findActiveVehicleAssignment: mocks.findActiveVehicleAssignment, sastWorkDate: mocks.sastWorkDate,
}));
vi.mock('@/modules/attendance/corrections/queries', () => ({ countOwnAdjustmentsByStatus: mocks.countOwnAdjustmentsByStatus }));
vi.mock('@/modules/payslips/queries', () => ({ findLatestPayslipForStaff: mocks.findLatestPayslipForStaff }));
vi.mock('@/modules/receipts/queries', () => ({ findLatestReceiptForStaff: mocks.findLatestReceiptForStaff }));
vi.mock('@/modules/attendance/workflow/requiredActionQueries', () => ({ findRequiredAttendanceAction: mocks.findRequiredAttendanceAction }));
vi.mock('@/modules/fleet/incidents/driver/driverIncidentService', () => ({ listDriverIncidents: mocks.listDriverIncidents }));

import handler from '../hub-summary';

function mockRes() {
  const res = {
    statusCode: 0, body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; }, end() { return this; },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}
async function call() {
  const res = mockRes();
  await handler({ method: 'GET', query: {} } as unknown as NextApiRequest, res);
  return res;
}

beforeEach(() => { vi.clearAllMocks(); mocks.sql.mockResolvedValue([{ count: '0' }]); });

describe('GET /api/my/hub-summary — fleetIncidents', () => {
  it('scopes the incident count read to session.staffId, never a request field', async () => {
    mocks.listDriverIncidents.mockResolvedValue({ incidents: [], total: 0, recentWindowDays: 90, historyWindowDays: 365 });
    await call();
    expect(mocks.listDriverIncidents).toHaveBeenCalledWith(SESSION.staffId, expect.any(Object));
  });

  it('reports activeCount as the number of non-closed incidents', async () => {
    mocks.listDriverIncidents.mockResolvedValue({
      incidents: [
        { lifecyclePresentation: 'Open', driverInputState: 'not_requested' },
        { lifecyclePresentation: 'Being reviewed', driverInputState: 'requested' },
        { lifecyclePresentation: 'Closed', driverInputState: 'closed' },
      ],
      total: 3, recentWindowDays: 90, historyWindowDays: 365,
    });
    const res = await call();
    expect((res.body as { data: { fleetIncidents: { activeCount: number } } }).data.fleetIncidents.activeCount).toBe(2);
  });

  it('reports inputRequestedCount as only the incidents currently awaiting the driver, before activeCount in the summary ordering', async () => {
    mocks.listDriverIncidents.mockResolvedValue({
      incidents: [
        { lifecyclePresentation: 'Open', driverInputState: 'requested' },
        { lifecyclePresentation: 'Open', driverInputState: 'not_requested' },
      ],
      total: 2, recentWindowDays: 90, historyWindowDays: 365,
    });
    const res = await call();
    const fleetIncidents = (res.body as { data: { fleetIncidents: { activeCount: number; inputRequestedCount: number } } }).data.fleetIncidents;
    expect(fleetIncidents.inputRequestedCount).toBe(1);
    expect(fleetIncidents.activeCount).toBe(2);
    expect(Object.keys(fleetIncidents)).toEqual(['inputRequestedCount', 'activeCount']);
  });

  it('degrades to zero counts (never a 500 for the whole hub) when the incident read fails', async () => {
    mocks.listDriverIncidents.mockRejectedValue(new Error('db down'));
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { fleetIncidents: { activeCount: number; inputRequestedCount: number } } }).data.fleetIncidents).toEqual({
      inputRequestedCount: 0, activeCount: 0,
    });
  });

  it('counts only the returned page (never fetches beyond the route\'s own 100-item limit) when total exceeds it, but logs the truncation for visibility', async () => {
    const incidents = Array.from({ length: 100 }, (_, i) => ({
      lifecyclePresentation: 'Open', driverInputState: i === 0 ? 'requested' : 'not_requested',
    }));
    mocks.listDriverIncidents.mockResolvedValue({ incidents, total: 137, recentWindowDays: 90, historyWindowDays: 365 });

    const res = await call();

    expect(mocks.listDriverIncidents).toHaveBeenCalledWith(SESSION.staffId, expect.objectContaining({ limit: 100 }));
    const fleetIncidents = (res.body as { data: { fleetIncidents: { activeCount: number; inputRequestedCount: number } } }).data.fleetIncidents;
    expect(fleetIncidents).toEqual({ inputRequestedCount: 1, activeCount: 100 });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining('truncated'),
      expect.objectContaining({ staffId: SESSION.staffId, total: 137, countedIncidents: 100 }),
    );
  });

  it('does not log a truncation warning when the returned page already covers the full total', async () => {
    mocks.listDriverIncidents.mockResolvedValue({
      incidents: [{ lifecyclePresentation: 'Open', driverInputState: 'requested' }],
      total: 1, recentWindowDays: 90, historyWindowDays: 365,
    });

    await call();

    expect(mocks.logWarn).not.toHaveBeenCalledWith(expect.stringContaining('truncated'), expect.anything());
  });
});
