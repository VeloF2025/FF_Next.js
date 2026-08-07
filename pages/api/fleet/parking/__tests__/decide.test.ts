import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
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
