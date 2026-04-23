/**
 * Handler tests for POST /api/staff/attendance-corrections-review.
 *
 * Post-hardening the approve path runs inside a DB transaction via
 * `applyApprovedAdjustmentTxn`. We mock that helper directly so the tests
 * stay focused on handler orchestration: validation, lock guard, state
 * machine dispatch, and the response shape for each conflict variant.
 * The transactional semantics themselves (optimistic concurrency, side
 * effects all-or-nothing) belong in a queries-layer test.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  applyApprovedAdjustmentTxn: vi.fn(),
  transitionAdjustmentStatus: vi.fn(),
  loadAdjustmentWithEntry: vi.fn(),
  lookupActiveLock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/services/attendance/supervisorScope', () => ({
  authorizedToSuperviseStaff: vi.fn().mockResolvedValue(true),
  staffIdsSupervisedBy: vi.fn().mockResolvedValue(null),
  canSuperviseStaff: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/modules/attendance/corrections/queries', () => ({
  applyApprovedAdjustmentTxn: mocks.applyApprovedAdjustmentTxn,
  transitionAdjustmentStatus: mocks.transitionAdjustmentStatus,
  loadAdjustmentWithEntry: mocks.loadAdjustmentWithEntry,
}));
vi.mock('@/modules/attendance/corrections/lockQueries', () => ({
  lookupActiveLock: mocks.lookupActiveLock,
  // re-exported from service/attendance/isoWeek in real module
  isoWeekMonday: (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    const dow = d.getUTCDay();
    const delta = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  },
}));

import handler from '../../../../../pages/api/staff/attendance-corrections-review';

function makeReq(
  body: Record<string, unknown> = {},
  method: string = 'POST',
  userId: string | null = 'reviewer-1'
): NextApiRequest {
  const r: Partial<NextApiRequest> & { user?: { id: string } } = {
    method,
    query: {},
    headers: {},
    body,
  };
  if (userId) r.user = { id: userId };
  return r as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown; headers: Record<string, string> } = {
    statusCode: 200,
    headers: {},
  };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    send(d: unknown) { captured.body = d; return this; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

const EXISTING = {
  adjustment: {
    id: 'adj-1',
    entry_id: 'e-1',
    requested_by: 'staff-1',
    adjustment_kind: 'forgot_clock_out' as const,
    adjusted_clock_in_at: null,
    adjusted_clock_out_at: '2026-04-20T14:00:00+00:00',
    adjusted_site_geofence_id: null,
    reason: 'forgot to clock out',
    status: 'pending' as const,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    created_at: '2026-04-20T15:00:00Z',
    updated_at: '2026-04-20T15:00:00Z',
  },
  entry: {
    id: 'e-1',
    staff_id: 'staff-1',
    work_date: '2026-04-20',
    clock_in_at: '2026-04-20T06:00:00+00:00',
    clock_out_at: null,
    status: 'open',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/staff/attendance-corrections-review', () => {
  it('405 on non-POST', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('401 when authed user missing', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'approve' }, 'POST', null), res);
    expect(captured.statusCode).toBe(401);
  });

  it('400 when adjustment_id missing', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ action: 'approve' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('400 when action is neither approve nor reject', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'delete' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('400 when reject has empty review_note (audit + staff explanation)', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'reject' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('400 when reject review_note < 10 chars', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'reject', review_note: 'dup' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('404 when adjustment missing', async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(null);
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'missing', action: 'approve' }), res);
    expect(captured.statusCode).toBe(404);
  });

  it('409 when adjustment already resolved (state machine)', async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce({
      ...EXISTING,
      adjustment: { ...EXISTING.adjustment, status: 'approved' },
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'approve' }), res);
    expect(captured.statusCode).toBe(409);
    // Crucial: no transactional apply runs after the state-check 409.
    expect(mocks.applyApprovedAdjustmentTxn).not.toHaveBeenCalled();
  });

  it("409 when the entry's week is locked (approve path)", async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(EXISTING);
    mocks.lookupActiveLock.mockResolvedValueOnce({
      week_start_date: '2026-04-20',
      locked_at: 'x',
      locked_by: 'admin-1',
      lock_reason: 'export:csv',
      unlocked_at: null,
      unlocked_by: null,
      unlock_reason: null,
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'approve' }), res);
    expect(captured.statusCode).toBe(409);
    expect(mocks.applyApprovedAdjustmentTxn).not.toHaveBeenCalled();
  });

  it("409 when the entry's week is locked (reject path)", async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(EXISTING);
    mocks.lookupActiveLock.mockResolvedValueOnce({
      week_start_date: '2026-04-20',
      locked_at: 'x', locked_by: 'admin-1', lock_reason: null,
      unlocked_at: null, unlocked_by: null, unlock_reason: null,
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ adjustment_id: 'adj-1', action: 'reject', review_note: 'this is a sufficient reason' }),
      res
    );
    expect(captured.statusCode).toBe(409);
    expect(mocks.transitionAdjustmentStatus).not.toHaveBeenCalled();
  });

  it('approve happy path — delegates to transactional helper, returns row', async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(EXISTING);
    mocks.lookupActiveLock.mockResolvedValueOnce(null);
    // fetchEntryUpdatedAt — inline sql import
    mocks.sql.mockResolvedValueOnce([{ updated_at: '2026-04-20T15:00:00+00:00' }]);
    mocks.applyApprovedAdjustmentTxn.mockResolvedValueOnce({
      ok: true,
      adjustment: { ...EXISTING.adjustment, status: 'approved', reviewed_by: 'reviewer-1' },
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'approve' }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.applyApprovedAdjustmentTxn).toHaveBeenCalledTimes(1);
    const args = mocks.applyApprovedAdjustmentTxn.mock.calls[0]![0];
    expect(args.adjustmentId).toBe('adj-1');
    expect(args.reviewerId).toBe('reviewer-1');
    expect(args.entryUpdatedAt).toBe('2026-04-20T15:00:00+00:00');
  });

  it('reject happy path — transitions, never calls approve transaction', async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(EXISTING);
    mocks.lookupActiveLock.mockResolvedValueOnce(null);
    mocks.transitionAdjustmentStatus.mockResolvedValueOnce({
      ...EXISTING.adjustment,
      status: 'rejected',
      reviewed_by: 'reviewer-1',
      review_note: 'this is a sufficient reason',
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ adjustment_id: 'adj-1', action: 'reject', review_note: 'this is a sufficient reason' }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.applyApprovedAdjustmentTxn).not.toHaveBeenCalled();
    expect(mocks.transitionAdjustmentStatus).toHaveBeenCalledTimes(1);
    expect(mocks.transitionAdjustmentStatus.mock.calls[0]![0].newStatus).toBe('rejected');
  });

  it('approve conflict — adjustment_not_pending', async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(EXISTING);
    mocks.lookupActiveLock.mockResolvedValueOnce(null);
    mocks.sql.mockResolvedValueOnce([{ updated_at: '2026-04-20T15:00:00+00:00' }]);
    mocks.applyApprovedAdjustmentTxn.mockResolvedValueOnce({
      ok: 'conflict',
      reason: 'adjustment_not_pending',
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'approve' }), res);
    expect(captured.statusCode).toBe(409);
  });

  it('approve conflict — entry_changed (race vs reconcile cron auto-close)', async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(EXISTING);
    mocks.lookupActiveLock.mockResolvedValueOnce(null);
    mocks.sql.mockResolvedValueOnce([{ updated_at: '2026-04-20T15:00:00+00:00' }]);
    mocks.applyApprovedAdjustmentTxn.mockResolvedValueOnce({
      ok: 'conflict',
      reason: 'entry_changed',
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'approve' }), res);
    expect(captured.statusCode).toBe(409);
    const body = captured.body as { error: { message: string } };
    expect(body.error.message).toMatch(/modified|reconcile cron|reviewer/i);
  });

  it('approve conflict — entry_missing', async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(EXISTING);
    mocks.lookupActiveLock.mockResolvedValueOnce(null);
    mocks.sql.mockResolvedValueOnce([{ updated_at: '2026-04-20T15:00:00+00:00' }]);
    mocks.applyApprovedAdjustmentTxn.mockResolvedValueOnce({
      ok: 'conflict',
      reason: 'entry_missing',
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ adjustment_id: 'adj-1', action: 'approve' }), res);
    expect(captured.statusCode).toBe(409);
  });

  it('reject concurrent-review — transitionAdjustmentStatus returns null → 409', async () => {
    mocks.loadAdjustmentWithEntry.mockResolvedValueOnce(EXISTING);
    mocks.lookupActiveLock.mockResolvedValueOnce(null);
    mocks.transitionAdjustmentStatus.mockResolvedValueOnce(null);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ adjustment_id: 'adj-1', action: 'reject', review_note: 'this is a sufficient reason' }),
      res
    );
    expect(captured.statusCode).toBe(409);
    // No approve transaction ran — reject path only.
    expect(mocks.applyApprovedAdjustmentTxn).not.toHaveBeenCalled();
  });
});
