/**
 * Contractor→project assignment gate wiring (goal §7.3 + G1 fail-closed).
 *
 * The assignment endpoint is the enforcement point: a failed H&S verdict must
 * 403, and — the G1 change this guards — a gate that ERRORS must FAIL CLOSED
 * (503, no assignment), not wave the contractor through. Without this test the
 * fail-open regression is a one-line edit nothing would catch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, gateMock } = vi.hoisted(() => ({ sqlMock: vi.fn(), gateMock: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: (req: NextApiRequest, res: NextApiResponse) => unknown) => h,
  getAuthUser: vi.fn(() => ({ id: 'user-1', email: 'a@velocityfibre.co.za' })),
}));
vi.mock('@/modules/health-safety/services/gateService', () => ({
  checkContractorGate: gateMock,
}));

import handler from '../../../../pages/api/contractors-projects';

const BODY = {
  contractorId: 'c1',
  projectId: 'p1',
  role: 'installation',
  startDate: '2026-07-24',
};

function post() {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body: BODY });
  return { req, res };
}

describe('POST /api/contractors-projects — H&S gate enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing assignment (the pre-gate duplicate check returns []).
    sqlMock.mockResolvedValue([]);
  });

  it('FAILS CLOSED with 503 when the gate check itself throws (G1)', async () => {
    gateMock.mockRejectedValueOnce(new Error('db unreachable'));
    const { req, res } = post();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(503);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(false);
    expect(body.gate_check.can_assign).toBe(false);
    // No INSERT must have run — only the duplicate-check SELECT.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('blocks with 403 when the gate returns a failed verdict', async () => {
    gateMock.mockResolvedValueOnce({ can_assign: false, blockers: ['Missing Safety Policy'], warnings: [] });
    const { req, res } = post();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    const body = JSON.parse(res._getData());
    expect(body.gate_check.blockers).toContain('Missing Safety Policy');
    expect(sqlMock).toHaveBeenCalledTimes(1); // no INSERT
  });

  it('proceeds to create the assignment when the gate passes', async () => {
    gateMock.mockResolvedValueOnce({ can_assign: true, blockers: [], warnings: [] });
    // duplicate-check SELECT → [] ; INSERT → the created row.
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'assignment-1', contractor_id: 'c1', project_id: 'p1' }]);
    const { req, res } = post();
    await handler(req, res);

    expect([200, 201]).toContain(res._getStatusCode());
    // The INSERT ran (more than just the duplicate-check SELECT).
    expect(sqlMock.mock.calls.length).toBeGreaterThan(1);
  });
});
