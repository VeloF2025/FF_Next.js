/**
 * Handler tests for /api/my/attendance-corrections.
 *
 * Covers submit validation, IDOR guard (staff can't submit for another
 * staff's entry), lock rejection, and own-list scoping.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  // Bypass session verification. Set staffId via makeReq.session below.
  withMySession: (h: (r: NextApiRequest, s: NextApiResponse, sess: { staffId: string; sessionId: string; loginMethod: 'pin' }) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      h(req, res, (req as unknown as { session: { staffId: string; sessionId: string; loginMethod: 'pin' } }).session),
}));

import handler from '../../../../../pages/api/my/attendance-corrections';

function makeReq(
  body: Record<string, unknown> = {},
  method: string = 'POST',
  query: Record<string, string> = {},
  staffId = 'staff-1'
): NextApiRequest {
  return {
    method,
    query,
    headers: {},
    body,
    session: { staffId, sessionId: 'sess-1', loginMethod: 'pin' },
  } as unknown as NextApiRequest;
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/my/attendance-corrections', () => {
  it('400 when entry_id missing', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        adjustment_kind: 'forgot_clock_out',
        adjusted_clock_out_at: '2026-04-20T14:00:00Z',
        reason: 'real reason with length',
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400 when adjustment_kind invalid', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        entry_id: 'e-1',
        adjustment_kind: 'bogus',
        adjusted_clock_out_at: '2026-04-20T14:00:00Z',
        reason: 'real reason with length',
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400 when reason < 10 chars', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        entry_id: 'e-1',
        adjustment_kind: 'forgot_clock_out',
        adjusted_clock_out_at: '2026-04-20T14:00:00Z',
        reason: 'too short',
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400 when no adjusted_* field is provided (at-least-one-change rule)', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        entry_id: 'e-1',
        adjustment_kind: 'other',
        reason: 'trying to submit an empty correction',
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('404 when entry not owned by session staff (IDOR guard) — and INSERT is NOT reached', async () => {
    mocks.sql.mockResolvedValueOnce([{ staff_id: 'someone-else', work_date: '2026-04-20' }]);
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        entry_id: 'e-1',
        adjustment_kind: 'forgot_clock_out',
        adjusted_clock_out_at: '2026-04-20T14:00:00Z',
        reason: 'real reason with length',
      }),
      res
    );
    expect(captured.statusCode).toBe(404);
    // Defence-in-depth: an IDOR check that returns 404 but still runs the
    // INSERT would leak data across staff. Assert no insert happened.
    const calls = mocks.sql.mock.calls as [readonly string[], ...unknown[]][];
    const insertCall = calls.find((c) =>
      /INSERT\s+INTO\s+attendance_adjustments/i.test(c[0].join(' '))
    );
    expect(insertCall).toBeUndefined();
  });

  it('400 when the entry’s week is locked', async () => {
    mocks.sql
      .mockResolvedValueOnce([{ staff_id: 'staff-1', work_date: '2026-04-22' }]) // entry owned; week Mon = 2026-04-20
      .mockResolvedValueOnce([
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
    await handler(
      makeReq({
        entry_id: 'e-1',
        adjustment_kind: 'forgot_clock_out',
        adjusted_clock_out_at: '2026-04-22T14:00:00Z',
        reason: 'forgot to clock out this evening',
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
    const body = captured.body as { error: { message: string } };
    expect(body.error.message).toMatch(/locked/i);
  });

  it('happy path — inserts adjustment and returns the row', async () => {
    mocks.sql
      .mockResolvedValueOnce([{ staff_id: 'staff-1', work_date: '2026-04-20' }])
      .mockResolvedValueOnce([]) // no lock
      .mockResolvedValueOnce([
        {
          id: 'adj-1',
          entry_id: 'e-1',
          requested_by: 'staff-1',
          adjustment_kind: 'forgot_clock_out',
          adjusted_clock_in_at: null,
          adjusted_clock_out_at: '2026-04-20T14:00:00+00:00',
          adjusted_site_geofence_id: null,
          reason: 'forgot to clock out after shift',
          status: 'pending',
          reviewed_by: null,
          reviewed_at: null,
          review_note: null,
          created_at: '2026-04-22T10:00:00Z',
          updated_at: '2026-04-22T10:00:00Z',
        },
      ]);
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        entry_id: 'e-1',
        adjustment_kind: 'forgot_clock_out',
        adjusted_clock_out_at: '2026-04-20T14:00:00Z',
        reason: 'forgot to clock out after shift',
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data: { adjustment: { id: string; status: string } } };
    expect(body.data.adjustment.id).toBe('adj-1');
    expect(body.data.adjustment.status).toBe('pending');
  });
});

describe('GET /api/my/attendance-corrections', () => {
  it('returns own adjustments scoped to session.staffId', async () => {
    mocks.sql.mockResolvedValueOnce([
      {
        id: 'adj-1',
        entry_id: 'e-1',
        requested_by: 'staff-1',
        adjustment_kind: 'forgot_clock_out',
        adjusted_clock_in_at: null,
        adjusted_clock_out_at: '2026-04-20T14:00:00+00:00',
        adjusted_site_geofence_id: null,
        reason: 'forgot to clock out',
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        created_at: '2026-04-22T10:00:00Z',
        updated_at: '2026-04-22T10:00:00Z',
      },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(200);
    const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    // The staff_id filter in the SQL must be parameterised with session.staffId.
    expect(call.slice(1)).toContain('staff-1');
  });
});
