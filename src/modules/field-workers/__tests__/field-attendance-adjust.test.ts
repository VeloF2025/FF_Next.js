/**
 * Tests for POST /api/field/attendance-adjust — admin-initiated time correction.
 *
 * Invariants:
 *   (a) Happy path: inserts adjustment, applies audited txn, returns the row.
 *   (b) Stale entry_updated_at → txn returns conflict/entry_changed → 409.
 *   (c) reason < 10 chars → 400 before any DB call.
 *   (d) Locked week → 409 before any adjustment insert.
 *   (e) Invalid ISO timestamp → 400 before any DB call.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  insertAdjustment: vi.fn(),
  applyApprovedAdjustmentTxn: vi.fn(),
  lookupActiveLock: vi.fn(),
  isoWeekMonday: vi.fn((d: string) => d.slice(0, 10)),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/modules/attendance/corrections/queries', () => ({
  insertAdjustment: mocks.insertAdjustment,
  applyApprovedAdjustmentTxn: mocks.applyApprovedAdjustmentTxn,
}));
vi.mock('@/modules/attendance/corrections/lockQueries', () => ({
  lookupActiveLock: mocks.lookupActiveLock,
  isoWeekMonday: mocks.isoWeekMonday,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '../../../../pages/api/field/attendance-adjust';

function makeReq(
  body: Record<string, unknown> = {},
  method = 'POST',
  userId: string | null = 'admin-user-1'
): NextApiRequest {
  const r: Partial<NextApiRequest> & { user?: { id: string } } = {
    method, query: {}, headers: {}, body,
  };
  if (userId) r.user = { id: userId };
  return r as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    send(d: unknown) { captured.body = d; return this; },
    setHeader() {},
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

const ENTRY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ENTRY_UPDATED_AT = '2026-06-20T06:00:00.000Z';
const STAFF_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const DB_ENTRY_ROW = { staff_id: STAFF_ID, work_date: '2026-06-20', site_geofence_id: 'geo-site-1' };
const ADJUSTMENT_ROW = {
  id: 'adj-001',
  entry_id: ENTRY_ID,
  requested_by: 'admin-user-1',
  adjustment_kind: 'wrong_clock_in_time',
  adjusted_clock_in_at: '2026-06-20T05:00:00.000Z',
  adjusted_clock_out_at: null,
  adjusted_site_geofence_id: 'geo-site-1',
  reason: 'Admin correcting wrong clock-in time recorded at site',
  status: 'approved',
  reviewed_by: 'admin-user-1',
  reviewed_at: '2026-06-20T07:00:00.000Z',
  review_note: 'Admin direct adjust (Field Workers page)',
  created_at: '2026-06-20T07:00:00.000Z',
  updated_at: '2026-06-20T07:00:00.000Z',
};
const VALID_BODY = {
  entry_id: ENTRY_ID,
  entry_updated_at: ENTRY_UPDATED_AT,
  adjusted_clock_in_at: '2026-06-20T05:00:00Z',
  reason: 'Admin correcting wrong clock-in time recorded at site',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookupActiveLock.mockResolvedValue(null);
  mocks.sql.mockResolvedValue([DB_ENTRY_ROW]);
  mocks.insertAdjustment.mockResolvedValue(ADJUSTMENT_ROW);
  mocks.applyApprovedAdjustmentTxn.mockResolvedValue({ ok: true, adjustment: ADJUSTMENT_ROW });
});

describe('POST /api/field/attendance-adjust', () => {
  it('405 on non-POST', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(405);
    expect(mocks.insertAdjustment).not.toHaveBeenCalled();
  });

  it('(c) 400 when reason < 10 chars', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID_BODY, reason: 'too short' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.insertAdjustment).not.toHaveBeenCalled();
  });

  it('400 when entry_id missing', async () => {
    const { entry_id: _o, ...rest } = VALID_BODY;
    const { res, captured } = makeRes();
    await handler(makeReq(rest), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('400 when entry_updated_at missing', async () => {
    const { entry_updated_at: _o, ...rest } = VALID_BODY;
    const { res, captured } = makeRes();
    await handler(makeReq(rest), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('400 when neither adjusted time provided', async () => {
    const { adjusted_clock_in_at: _o, ...rest } = VALID_BODY;
    const { res, captured } = makeRes();
    await handler(makeReq(rest), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  // (e) Invalid ISO timestamps → 400, not 500 (new Date('bad') throws on .toISOString())
  it('(e) 400 when adjusted_clock_in_at is not a valid ISO timestamp', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID_BODY, adjusted_clock_in_at: 'not-a-date' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.insertAdjustment).not.toHaveBeenCalled();
  });

  it('(e) 400 when adjusted_clock_out_at is not a valid ISO timestamp', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID_BODY, adjusted_clock_out_at: 'not-a-date' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.insertAdjustment).not.toHaveBeenCalled();
  });

  it('404 when entry not found in DB', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(404);
    expect(mocks.insertAdjustment).not.toHaveBeenCalled();
  });

  it('(d) 409 when payroll week is locked', async () => {
    mocks.lookupActiveLock.mockResolvedValueOnce({
      week_start_date: '2026-06-16', locked_at: '2026-06-21T09:00:00Z',
      locked_by: 'payroll-admin', lock_reason: 'export:payroll',
      unlocked_at: null, unlocked_by: null, unlock_reason: null,
    });
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(409);
    expect(mocks.insertAdjustment).not.toHaveBeenCalled();
  });

  it('(a) happy path: inserts adjustment, applies txn, returns adjustment', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { success: true; data: { adjustment: typeof ADJUSTMENT_ROW } };
    expect(body.data.adjustment).toEqual(ADJUSTMENT_ROW);

    expect(mocks.insertAdjustment).toHaveBeenCalledOnce();
    const ins = mocks.insertAdjustment.mock.calls[0]![0] as Record<string, unknown>;
    expect(ins.entryId).toBe(ENTRY_ID);
    expect(ins.requestedBy).toBe('admin-user-1');
    expect(['wrong_clock_in_time', 'wrong_clock_out_time']).toContain(ins.adjustmentKind);
    expect(ins.reason).toBe(VALID_BODY.reason);

    expect(mocks.applyApprovedAdjustmentTxn).toHaveBeenCalledOnce();
    const app = mocks.applyApprovedAdjustmentTxn.mock.calls[0]![0] as Record<string, unknown>;
    expect(app.adjustmentId).toBe(ADJUSTMENT_ROW.id);
    expect(app.reviewerId).toBe('admin-user-1');
    expect(app.entryId).toBe(ENTRY_ID);
    expect(app.entryUpdatedAt).toBe(ENTRY_UPDATED_AT);
    expect(app.staffId).toBe(STAFF_ID);
    expect(app.workDate).toBe(DB_ENTRY_ROW.work_date);
  });

  it('(a) only clock_out → kind = wrong_clock_out_time', async () => {
    const body = {
      entry_id: ENTRY_ID, entry_updated_at: ENTRY_UPDATED_AT,
      adjusted_clock_out_at: '2026-06-20T15:00:00Z',
      reason: 'Admin correcting wrong clock-out time recorded at site',
    };
    const { res, captured } = makeRes();
    await handler(makeReq(body), res);
    expect(captured.statusCode).toBe(200);
    const ins = mocks.insertAdjustment.mock.calls[0]![0] as Record<string, unknown>;
    expect(ins.adjustmentKind).toBe('wrong_clock_out_time');
  });

  it('(a) both times → kind = wrong_clock_in_time (label only; txn applies both)', async () => {
    const body = {
      entry_id: ENTRY_ID, entry_updated_at: ENTRY_UPDATED_AT,
      adjusted_clock_in_at: '2026-06-20T05:30:00Z',
      adjusted_clock_out_at: '2026-06-20T14:30:00Z',
      reason: 'Admin correcting both clock times recorded at site',
    };
    const { res, captured } = makeRes();
    await handler(makeReq(body), res);
    expect(captured.statusCode).toBe(200);
    const ins = mocks.insertAdjustment.mock.calls[0]![0] as Record<string, unknown>;
    expect(ins.adjustmentKind).toBe('wrong_clock_in_time');
  });

  it('(b) stale entry_updated_at → txn returns entry_changed → 409', async () => {
    mocks.applyApprovedAdjustmentTxn.mockResolvedValueOnce({ ok: 'conflict', reason: 'entry_changed' });
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(409);
    expect(mocks.insertAdjustment).toHaveBeenCalledOnce();
    expect(mocks.applyApprovedAdjustmentTxn).toHaveBeenCalledOnce();
  });

  it('adjustment_not_pending conflict → 409', async () => {
    mocks.applyApprovedAdjustmentTxn.mockResolvedValueOnce({ ok: 'conflict', reason: 'adjustment_not_pending' });
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(409);
  });

  it('500 when DB entry lookup throws', async () => {
    mocks.sql.mockRejectedValueOnce(new Error('pg connection lost'));
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(500);
  });
});
