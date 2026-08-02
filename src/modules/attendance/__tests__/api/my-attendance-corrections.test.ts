/**
 * Handler tests for /api/my/attendance-corrections.
 *
 * Covers submit validation, IDOR guard (staff can't submit for another
 * staff's entry), lock rejection, and own-list scoping.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  submitMissingClockOutCorrection: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/modules/attendance/workflow/requiredActionQueries', () => ({
  AttendanceCorrectionError: class AttendanceCorrectionError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = 'AttendanceCorrectionError';
    }
  },
  submitMissingClockOutCorrection: mocks.submitMissingClockOutCorrection,
}));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  // Bypass session verification. Set staffId via makeReq.session below.
  withMySession: (h: (r: NextApiRequest, s: NextApiResponse, sess: { staffId: string; sessionId: string; loginMethod: 'pin' }) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      h(req, res, (req as unknown as { session: { staffId: string; sessionId: string; loginMethod: 'pin' } }).session),
}));

import handler from '../../../../../pages/api/my/attendance-corrections';
import { AttendanceCorrectionError } from '@/modules/attendance/workflow/requiredActionQueries';

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
  it('persists a missing-clock-out exception correction and returns the workflow IDs', async () => {
    mocks.submitMissingClockOutCorrection.mockResolvedValue({
      adjustmentId: 'adj-required',
      exceptionId: 'exception-required',
      exceptionStatus: 'awaiting_supervisor',
    });
    const { res, captured } = makeRes();

    await handler(
      makeReq({
        exception_id: 'exception-required',
        adjusted_clock_out_at: '2026-04-20T14:00:00Z',
        reason: 'forgot during the site handover',
      }),
      res
    );

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      success: true,
      data: {
        adjustmentId: 'adj-required',
        exceptionId: 'exception-required',
        exceptionStatus: 'awaiting_supervisor',
      },
    });
    expect(mocks.submitMissingClockOutCorrection).toHaveBeenCalledWith({
      staffId: 'staff-1',
      exceptionId: 'exception-required',
      adjustedClockOutAt: new Date('2026-04-20T14:00:00Z'),
      reason: 'forgot during the site handover',
    });
  });

  it('returns an IDOR-safe 404 for a foreign exception', async () => {
    mocks.submitMissingClockOutCorrection.mockRejectedValue(
      new AttendanceCorrectionError('not_found', 'Attendance exception not found')
    );
    const { res, captured } = makeRes();

    await handler(makeReq({
      exception_id: 'exception-foreign',
      adjusted_clock_out_at: '2026-04-20T14:00:00Z',
      reason: 'forgot during the site handover',
    }), res);

    expect(captured.statusCode).toBe(404);
    expect(captured.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 409 period_locked for a correction in a locked week', async () => {
    mocks.submitMissingClockOutCorrection.mockRejectedValue(
      new AttendanceCorrectionError('period_locked', 'The attendance period is locked')
    );
    const { res, captured } = makeRes();

    await handler(makeReq({
      exception_id: 'exception-locked',
      adjusted_clock_out_at: '2026-04-20T14:00:00Z',
      reason: 'forgot during the site handover',
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({
      error: { details: { reason: 'period_locked' } },
    });
  });

  it('returns 409 when a different correction is already pending', async () => {
    mocks.submitMissingClockOutCorrection.mockRejectedValue(
      new AttendanceCorrectionError('already_submitted', 'A different correction is already pending')
    );
    const { res, captured } = makeRes();

    await handler(makeReq({
      exception_id: 'exception-submitted',
      adjusted_clock_out_at: '2026-04-20T14:00:00Z',
      reason: 'a different clock out claim',
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({
      error: { details: { reason: 'correction_already_submitted' } },
    });
  });

  it('retires generic entry corrections without reading or writing attendance data', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({
      entry_id: 'e-1',
      adjustment_kind: 'forgot_clock_out',
      adjusted_clock_out_at: '2026-04-20T14:00:00Z',
      reason: 'forgot to clock out after shift',
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({
      error: { message: expect.stringMatching(/generic.*retired.*day exception/i) },
    });
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});

describe('GET /api/my/attendance-corrections', () => {
  it('returns own adjustments scoped to session.staffId plus the counts badge', async () => {
    // Handler now fires list + counts in parallel (#1409), so mock both.
    // Order isn't guaranteed across Promise.all, so match on query shape
    // when asserting — both mocks return mock fixtures.
    mocks.sql
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
        { status: 'pending', count: '1' },
        { status: 'approved', count: '4' },
      ]);
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(200);

    // Locate the list call (it has LIMIT in its template).
    const calls = mocks.sql.mock.calls as Array<[readonly string[], ...unknown[]]>;
    const listCall = calls.find((c) => /LIMIT/i.test(c[0].join(' ')));
    expect(listCall).toBeDefined();
    expect(listCall!.slice(1)).toContain('staff-1');

    // Response carries the counts badge + statusFilter echo.
    const body = captured.body as {
      data: {
        counts: { pending: number; approved: number; rejected: number; cancelled: number };
        statusFilter: string;
      };
    };
    expect(body.data.counts).toEqual({ pending: 1, approved: 4, rejected: 0, cancelled: 0 });
    expect(body.data.statusFilter).toBe('all');
  });
});

describe('DELETE /api/my/attendance-corrections', () => {
  it('400 when adjustment_id query param missing', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'DELETE', {}), res);
    expect(captured.statusCode).toBe(400);
  });

  it('200 when the atomic UPDATE cancels the staff own pending adjustment', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'adj-1', status: 'cancelled', review_note: 'self-cancelled by staff' },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'DELETE', { adjustment_id: 'adj-1' }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data: { adjustment: { status: string } } };
    expect(body.data.adjustment.status).toBe('cancelled');
  });

  it('404 when the adjustment does not exist (IDOR-safe)', async () => {
    mocks.sql
      .mockResolvedValueOnce([]) // UPDATE matched 0 rows
      .mockResolvedValueOnce([]); // disambiguating SELECT found nothing
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'DELETE', { adjustment_id: 'unknown' }), res);
    expect(captured.statusCode).toBe(404);
  });

  it('404 when the adjustment belongs to another staff (IDOR-safe — does not leak existence)', async () => {
    mocks.sql
      .mockResolvedValueOnce([]) // UPDATE matched 0 rows
      .mockResolvedValueOnce([{ status: 'pending', staff_id: 'someone-else' }]);
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'DELETE', { adjustment_id: 'adj-foreign' }), res);
    expect(captured.statusCode).toBe(404);
  });

  it('409 when the adjustment is already non-pending (approved / rejected / cancelled)', async () => {
    mocks.sql
      .mockResolvedValueOnce([]) // UPDATE matched 0 rows
      .mockResolvedValueOnce([{ status: 'approved', staff_id: 'staff-1' }]);
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'DELETE', { adjustment_id: 'adj-approved' }), res);
    expect(captured.statusCode).toBe(409);
  });

  it('409 period_locked when own pending cancellation loses to a weekly lock', async () => {
    mocks.sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'pending', staff_id: 'staff-1', period_locked: true }]);
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'DELETE', { adjustment_id: 'adj-pending' }), res);
    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: { details: { reason: 'period_locked' } } });
  });
});
