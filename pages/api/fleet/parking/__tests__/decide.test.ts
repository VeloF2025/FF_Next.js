import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// The permission arguments are CAPTURED, not discarded. Mocking
// `withPermission: () => h => h` makes the gate invisible to the suite: change
// 'edit' to 'view', typo the resource key, or delete the wrapper entirely and
// every test still passes. This is the gate on a decision that carries
// disciplinary consequence, so it is asserted explicitly below.
// vi.hoisted because vi.mock is hoisted above ordinary const declarations —
// a plain `const` here throws "cannot access before initialization".
const withPermissionArgs = vi.hoisted(() => [] as Array<[string, string]>);
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: (key: string, action: string) => {
    withPermissionArgs.push([key, action]);
    return (h: unknown) => h;
  },
}));

const decideRequest = vi.fn();
vi.mock('@/modules/fleet/parking/approvalQueries', () => ({
  decideRequest: (...a: unknown[]) => decideRequest(...a),
}));

const notifyParkingChangeDecided = vi.fn();
vi.mock('@/modules/fleet/parking/decisionNotifications', () => ({
  notifyParkingChangeDecided: (...a: unknown[]) => notifyParkingChangeDecided(...a),
}));

const resolveStaffId = vi.fn();
vi.mock('@/modules/fleet/parking/staffLookup', () => ({
  resolveStaffIdForUser: (...a: unknown[]) => resolveStaffId(...a),
}));

import handler from '../requests/[requestId]/decide';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
    end() {
      return this;
    },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}

function call(req: Partial<NextApiRequest>) {
  const res = mockRes();
  return Promise.resolve(
    (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => unknown)(
      { user: { id: 'user-1', role: 'manager' }, ...req } as unknown as NextApiRequest,
      res
    )
  ).then(() => res);
}

const OK = { ok: true, vehicleId: 'veh-1', registration: 'LN40MGGP', driverStaffId: 'staff-1' };

beforeEach(() => {
  decideRequest.mockReset().mockResolvedValue(OK);
  notifyParkingChangeDecided.mockReset().mockResolvedValue(undefined);
  resolveStaffId.mockReset().mockResolvedValue('staff-approver');
});

describe('POST /api/fleet/parking/requests/[requestId]/decide', () => {
  it('approves and notifies the driver', async () => {
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(200);
    expect(decideRequest.mock.calls[0]![0]).toMatchObject({
      requestId: 'req-1',
      outcome: 'approved',
      decidedByUserId: 'user-1',
      decidedByStaffId: 'staff-approver',
    });
    expect(notifyParkingChangeDecided).toHaveBeenCalledTimes(1);
  });

  it('rejects with a note', async () => {
    await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'rejected', decisionNote: 'Too far from the depot' },
    });
    expect(decideRequest.mock.calls[0]![0]).toMatchObject({
      outcome: 'rejected',
      decisionNote: 'Too far from the depot',
    });
  });

  it('treats a blank note as no note', async () => {
    await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'approved', decisionNote: '   ' },
    });
    expect(decideRequest.mock.calls[0]![0].decisionNote).toBeNull();
  });

  it.each([
    ['an unknown outcome', { outcome: 'maybe' }],
    ['a missing outcome', {}],
    ['a non-string outcome', { outcome: 1 }],
  ])('400s on %s', async (_label, body) => {
    const res = await call({ method: 'POST', query: { requestId: 'req-1' }, body });
    expect(res.statusCode).toBe(400);
    expect(decideRequest).not.toHaveBeenCalled();
  });

  // A repeated query param arrives as an array; coercing it would decide an
  // arbitrary one of them.
  it('400s on a repeated requestId', async () => {
    const res = await call({
      method: 'POST',
      query: { requestId: ['a', 'b'] },
      body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(400);
    expect(decideRequest).not.toHaveBeenCalled();
  });

  it('404s when the request does not exist', async () => {
    decideRequest.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await call({
      method: 'POST',
      query: { requestId: 'nope' },
      body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(404);
    expect(notifyParkingChangeDecided).not.toHaveBeenCalled();
  });

  // Someone else got there first. That is a conflict, not a server fault.
  it('409s when the request was already decided', async () => {
    decideRequest.mockResolvedValue({ ok: false, reason: 'not_pending' });
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(409);
    expect(notifyParkingChangeDecided).not.toHaveBeenCalled();
  });

  it('409s when the driver no longer holds the vehicle', async () => {
    decideRequest.mockResolvedValue({ ok: false, reason: 'assignment_ended' });
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(409);
    expect(notifyParkingChangeDecided).not.toHaveBeenCalled();
  });

  it('500s when the transaction throws', async () => {
    decideRequest.mockRejectedValue(new Error('deadlock detected'));
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(500);
  });

  it('rejects a non-POST method', async () => {
    const res = await call({ method: 'GET', query: { requestId: 'req-1' } });
    expect(res.statusCode).toBe(405);
    expect(decideRequest).not.toHaveBeenCalled();
  });
});

describe('authorization gate', () => {
  it('is wrapped in withPermission("fleet.parking-requests", "edit")', () => {
    // Mutation-kill: change the action to 'view', change the resource key, or
    // remove the wrapper, and this fails. Previously nothing did.
    expect(withPermissionArgs).toContainEqual(['fleet.parking-requests', 'edit']);
  });

  it('requires the EDIT action — a view-level grant must not decide', () => {
    // Named separately because 'view' is the action the sibling list routes
    // use, so a copy-paste between them is the realistic way this regresses.
    const parkingGates = withPermissionArgs.filter(([key]) => key === 'fleet.parking-requests');
    expect(parkingGates.length).toBeGreaterThan(0);
    for (const [, action] of parkingGates) expect(action).toBe('edit');
  });
});

describe('separation of duties and audit trail', () => {
  it('refuses a self-decision with 403, not a retryable conflict', async () => {
    // 403 rather than 409 deliberately: retrying never helps, a DIFFERENT
    // person has to act. A conflict code invites the client to try again.
    decideRequest.mockResolvedValue({ ok: false, reason: 'self_decision' });
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/somebody else/i);
  });

  it('rejects a decline with no note — the UI rule enforced server-side', async () => {
    // RequestCard disables the button, but that is a button, not a rule.
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'rejected' },
    });
    expect(res.statusCode).toBe(400);
    expect(decideRequest).not.toHaveBeenCalled();
  });

  it('rejects a decline whose note is only whitespace', async () => {
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'rejected', decisionNote: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(decideRequest).not.toHaveBeenCalled();
  });

  it('still allows an APPROVAL with no note', async () => {
    // Only declining requires a justification; approving the driver's own
    // stated address does not.
    decideRequest.mockResolvedValue({
      ok: true, vehicleId: 'v1', registration: 'AA11AAGP', driverStaffId: 's1',
    });
    const res = await call({
      method: 'POST', query: { requestId: 'req-1' }, body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('caps an over-long note instead of writing unbounded TEXT', async () => {
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'rejected', decisionNote: 'x'.repeat(1001) },
    });
    expect(res.statusCode).toBe(400);
    expect(decideRequest).not.toHaveBeenCalled();
  });
});
