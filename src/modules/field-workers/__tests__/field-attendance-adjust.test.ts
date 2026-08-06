/**
 * Tests for POST /api/field/attendance-adjust — admin-initiated time correction.
 *
 * Invariants:
 *   (a) Happy path: creates + applies in one guarded txn and returns the row.
 *   (b) Stale entry_updated_at → txn returns conflict/entry_changed → 409.
 *   (c) reason < 10 chars → 400 before any DB call.
 *   (d) Locked week → guarded txn rolls back and API returns 409.
 *   (e) Invalid ISO timestamp → 400 before any DB call.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  createAndApproveAdjustmentTxn: vi.fn(),
  isoWeekMonday: vi.fn((d: string) => d.slice(0, 10)),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/modules/attendance/corrections/guardedApproval', () => ({
  createAndApproveAdjustmentTxn: mocks.createAndApproveAdjustmentTxn,
}));
vi.mock('@/modules/attendance/corrections/lockQueries', () => ({
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
    method,
    query: {},
    headers: {},
    body,
  };
  if (userId) r.user = { id: userId };
  return r as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(c: number) {
      captured.statusCode = c;
      return this;
    },
    json(d: unknown) {
      captured.body = d;
      return this;
    },
    send(d: unknown) {
      captured.body = d;
      return this;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

const ENTRY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ENTRY_UPDATED_AT = '2026-06-20T06:00:00.000Z';
const STAFF_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const ACTOR_USER_ID = 'cccccccc-0000-0000-0000-000000000003';
const REQUESTER_STAFF_ID = 'dddddddd-0000-0000-0000-000000000004';
const DB_ENTRY_ROW = {
  staff_id: STAFF_ID,
  work_date: '2026-06-20',
  site_geofence_id: 'geo-site-1',
};
const ADJUSTMENT_ROW = {
  id: 'adj-001',
  entry_id: ENTRY_ID,
  requested_by: REQUESTER_STAFF_ID,
  adjustment_kind: 'wrong_clock_in_time',
  adjusted_clock_in_at: '2026-06-20T05:00:00.000Z',
  adjusted_clock_out_at: null,
  adjusted_site_geofence_id: 'geo-site-1',
  reason: 'Admin correcting wrong clock-in time recorded at site',
  status: 'approved',
  reviewed_by: ACTOR_USER_ID,
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
  mocks.sql.mockImplementation(async (strings: TemplateStringsArray) =>
    /FROM staff WHERE user_id/i.test(strings.join(' '))
      ? [{ id: REQUESTER_STAFF_ID }]
      : [DB_ENTRY_ROW]
  );
  mocks.createAndApproveAdjustmentTxn.mockResolvedValue({ ok: true, adjustment: ADJUSTMENT_ROW });
});

describe('POST /api/field/attendance-adjust', () => {
  it('405 on non-POST', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(405);
    expect(mocks.createAndApproveAdjustmentTxn).not.toHaveBeenCalled();
  });

  it('(c) 400 when reason < 10 chars', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID_BODY, reason: 'too short' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.createAndApproveAdjustmentTxn).not.toHaveBeenCalled();
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
    expect(mocks.createAndApproveAdjustmentTxn).not.toHaveBeenCalled();
  });

  it('(e) 400 when adjusted_clock_out_at is not a valid ISO timestamp', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID_BODY, adjusted_clock_out_at: 'not-a-date' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.createAndApproveAdjustmentTxn).not.toHaveBeenCalled();
  });

  // Ordering. A correction submitted days after its work date can carry the
  // submission date in the clock-in field; that is how a -61.5h row reached
  // the review queue and sat there for three months. Migration 482 enforces
  // the same rule in the schema — this arm exists so the worker gets a 400
  // rather than a constraint violation surfaced as a 500.
  it('400 when adjusted_clock_out_at precedes adjusted_clock_in_at', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        ...VALID_BODY,
        adjusted_clock_in_at: '2026-05-18T05:00:00Z', // submission date, not work date
        adjusted_clock_out_at: '2026-05-15T15:30:00Z',
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.createAndApproveAdjustmentTxn).not.toHaveBeenCalled();
  });

  it('400 when adjusted times are equal (zero-length shift)', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        ...VALID_BODY,
        adjusted_clock_in_at: '2026-06-20T05:00:00Z',
        adjusted_clock_out_at: '2026-06-20T05:00:00Z',
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
    expect(mocks.createAndApproveAdjustmentTxn).not.toHaveBeenCalled();
  });

  it('allows a shift ending after midnight the next day', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        ...VALID_BODY,
        adjusted_clock_in_at: '2026-06-20T21:00:00Z',
        adjusted_clock_out_at: '2026-06-21T05:00:00Z',
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.createAndApproveAdjustmentTxn).toHaveBeenCalled();
  });

  it('404 when entry not found in DB', async () => {
    mocks.sql.mockImplementation(async (strings: TemplateStringsArray) =>
      /FROM staff WHERE user_id/i.test(strings.join(' ')) ? [{ id: REQUESTER_STAFF_ID }] : []
    );
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(404);
    expect(mocks.createAndApproveAdjustmentTxn).not.toHaveBeenCalled();
  });

  it.each([
    ['no linked staff record', []],
    ['ambiguous linked staff records', [{ id: REQUESTER_STAFF_ID }, { id: 'staff-2' }]],
  ])('409 for %s', async (_case, rows) => {
    mocks.sql.mockResolvedValueOnce(rows);
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY, 'POST', ACTOR_USER_ID), res);
    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ success: false });
    expect(mocks.createAndApproveAdjustmentTxn).not.toHaveBeenCalled();
  });

  it.each(['active weekly lock', 'orphan locked daily row'])(
    '409 when the guarded transaction detects %s before insert',
    async () => {
      mocks.createAndApproveAdjustmentTxn.mockRejectedValueOnce(
        Object.assign(new Error('locked'), { code: 'period_locked' })
      );
      const { res, captured } = makeRes();
      await handler(makeReq(VALID_BODY), res);
      expect(captured.statusCode).toBe(409);
      expect(mocks.createAndApproveAdjustmentTxn).toHaveBeenCalledOnce();
    }
  );

  it('(a) happy path: inserts adjustment, applies txn, returns adjustment', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY, 'POST', ACTOR_USER_ID), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { success: true; data: { adjustment: typeof ADJUSTMENT_ROW } };
    expect(body.data.adjustment).toEqual(ADJUSTMENT_ROW);

    expect(mocks.createAndApproveAdjustmentTxn).toHaveBeenCalledOnce();
    const ins = mocks.createAndApproveAdjustmentTxn.mock.calls[0]![0] as Record<string, unknown>;
    expect(ins.entryId).toBe(ENTRY_ID);
    expect(ins.requestedBy).toBe(REQUESTER_STAFF_ID);
    expect(['wrong_clock_in_time', 'wrong_clock_out_time']).toContain(ins.adjustmentKind);
    expect(ins.reason).toBe(VALID_BODY.reason);

    expect(ins.reviewerId).toBe(ACTOR_USER_ID);
    expect(ins.entryUpdatedAt).toBe(ENTRY_UPDATED_AT);
    expect(ins.staffId).toBe(STAFF_ID);
    expect(ins.workDate).toBe(DB_ENTRY_ROW.work_date);
    const lookup = mocks.sql.mock.calls[0]!;
    expect(lookup[0].join(' ')).toMatch(/FROM staff WHERE user_id.*ORDER BY id LIMIT 2/i);
    expect(lookup.slice(1)).toContain(ACTOR_USER_ID);
  });

  it('(a) only clock_out → kind = wrong_clock_out_time', async () => {
    const body = {
      entry_id: ENTRY_ID,
      entry_updated_at: ENTRY_UPDATED_AT,
      adjusted_clock_out_at: '2026-06-20T15:00:00Z',
      reason: 'Admin correcting wrong clock-out time recorded at site',
    };
    const { res, captured } = makeRes();
    await handler(makeReq(body), res);
    expect(captured.statusCode).toBe(200);
    const ins = mocks.createAndApproveAdjustmentTxn.mock.calls[0]![0] as Record<string, unknown>;
    expect(ins.adjustmentKind).toBe('wrong_clock_out_time');
  });

  it('(a) both times → kind = wrong_clock_in_time (label only; txn applies both)', async () => {
    const body = {
      entry_id: ENTRY_ID,
      entry_updated_at: ENTRY_UPDATED_AT,
      adjusted_clock_in_at: '2026-06-20T05:30:00Z',
      adjusted_clock_out_at: '2026-06-20T14:30:00Z',
      reason: 'Admin correcting both clock times recorded at site',
    };
    const { res, captured } = makeRes();
    await handler(makeReq(body), res);
    expect(captured.statusCode).toBe(200);
    const ins = mocks.createAndApproveAdjustmentTxn.mock.calls[0]![0] as Record<string, unknown>;
    expect(ins.adjustmentKind).toBe('wrong_clock_in_time');
  });

  it('(b) stale entry_updated_at → txn returns entry_changed → 409', async () => {
    mocks.createAndApproveAdjustmentTxn.mockResolvedValueOnce({
      ok: 'conflict',
      reason: 'entry_changed',
    });
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(409);
    expect(mocks.createAndApproveAdjustmentTxn).toHaveBeenCalledOnce();
  });

  it('adjustment_not_pending conflict → 409', async () => {
    mocks.createAndApproveAdjustmentTxn.mockResolvedValueOnce({
      ok: 'conflict',
      reason: 'adjustment_not_pending',
    });
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
