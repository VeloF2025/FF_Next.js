/**
 * Handler tests for POST /api/staff/attendance-manual-entry.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  transaction: vi.fn(),
  txnQuery: vi.fn(),
  txnQueryOne: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql, transaction: mocks.transaction }));
vi.mock('@/services/attendance/supervisorScope', () => ({
  authorizedToSuperviseStaff: vi.fn().mockResolvedValue(true),
  staffIdsSupervisedBy: vi.fn().mockResolvedValue(null),
  canSuperviseStaff: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '../../../../../pages/api/staff/attendance-manual-entry';

function makeReq(
  body: Record<string, unknown> = {},
  method: string = 'POST',
  userId: string | null = 'supervisor-1'
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

// staff_id must be a real UUID since the handler now format-validates it (#2001).
const STAFF_UUID = '11111111-1111-1111-1111-111111111111';
const VALID_BODY = {
  staff_id: STAFF_UUID,
  clock_in_at: '2026-04-20T06:00:00Z',
  clock_out_at: '2026-04-20T14:00:00Z',
  notes: 'phone battery died; supervisor attests shift',
};

beforeEach(() => {
  vi.clearAllMocks();
  // transaction(cb) runs the callback with a fake txn whose query/queryOne
  // are the per-test mocks, then "commits" by returning the callback result.
  mocks.transaction.mockImplementation(
    async (
      cb: (txn: {
        client: unknown;
        query: typeof mocks.txnQuery;
        queryOne: typeof mocks.txnQueryOne;
      }) => unknown
    ) => cb({ client: {}, query: mocks.txnQuery, queryOne: mocks.txnQueryOne })
  );
});

describe('POST /api/staff/attendance-manual-entry', () => {
  it('405 on non-POST', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('400 when staff_id is not a valid UUID', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID_BODY, staff_id: 'staff-1' }), res);
    expect(captured.statusCode).toBe(400);
    // Reached neither the scope check nor any DB write.
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("400 when clock_out_at is before clock_in_at", async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ ...VALID_BODY, clock_out_at: '2026-04-20T05:00:00Z' }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400 when duration exceeds 24h', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ ...VALID_BODY, clock_out_at: '2026-04-21T07:00:00Z' }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400 when notes too short (audit requirement)', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID_BODY, notes: 'oops' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('409 when target week is locked', async () => {
    mocks.sql.mockResolvedValueOnce([
      {
        week_start_date: '2026-04-20',
        locked_at: '2026-04-21T09:00:00Z',
        locked_by: 'admin-1',
        lock_reason: 'export:csv',
        unlocked_at: null,
        unlocked_by: null,
        unlock_reason: null,
      },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(409);
    // No writes attempted on a locked week.
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('happy path — atomically inserts entry, raises manual_override exception (binds supervisor_user_id), deletes existing summary', async () => {
    mocks.sql.mockResolvedValueOnce([]); // no lock
    mocks.txnQueryOne.mockResolvedValueOnce({ id: 'new-entry' }); // INSERT entry RETURNING id
    mocks.txnQuery.mockResolvedValue([]); // exception insert + summary delete

    const { res, captured } = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data: { entry_id: string; work_date: string } };
    expect(body.data.entry_id).toBe('new-entry');
    expect(body.data.work_date).toBe('2026-04-20');

    // All three writes go through a single transaction (#1997).
    expect(mocks.transaction).toHaveBeenCalledTimes(1);

    const calls = mocks.txnQuery.mock.calls as [string, unknown[]][];
    const exceptionCall = calls.find((c) =>
      /INSERT\s+INTO\s+attendance_exceptions/i.test(c[0])
    );
    expect(exceptionCall).toBeDefined();
    const sqlText = exceptionCall![0];
    expect(sqlText).toMatch(/'manual_override'/);
    // Defence-in-depth: the exception details MUST embed the supervisor
    // user id so audit can answer "who clocked this staff in". A refactor
    // that drops the column from jsonb_build_object would silently erase
    // that trail.
    expect(sqlText).toMatch(/supervisor_user_id/);
    expect(exceptionCall![1]).toContain('supervisor-1');

    const deleteCall = calls.find((c) =>
      /DELETE\s+FROM\s+attendance_daily_summaries/i.test(c[0])
    );
    expect(deleteCall).toBeDefined();
  });
});
