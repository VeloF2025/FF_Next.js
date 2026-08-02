import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPeriodReadiness: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn() } }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: () => (handler: unknown) => handler,
}));
vi.mock('@/modules/attendance/workflow/periodQueries', () => ({
  getPeriodReadiness: mocks.getPeriodReadiness,
  AttendancePeriodError: class AttendancePeriodError extends Error { code = 'invalid_week'; },
}));

import handler from '../../../../../pages/api/staff/attendance-period-readiness';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/staff/attendance-period-readiness', () => {
  it('returns persisted readiness for the selected Monday', async () => {
    mocks.getPeriodReadiness.mockResolvedValueOnce({
      weekStartDate: '2026-08-03', weekEndDate: '2026-08-09', readyToLock: false,
    });
    const { res, captured } = response();
    await handler(request('GET', { week_start_date: '2026-08-03' }), res);
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ data: { weekStartDate: '2026-08-03', readyToLock: false } });
    expect(mocks.getPeriodReadiness).toHaveBeenCalledWith('2026-08-03');
  });

  it('rejects missing week and unsupported methods without querying readiness', async () => {
    let result = response();
    await handler(request('GET', {}), result.res);
    expect(result.captured.statusCode).toBe(400);
    result = response();
    await handler(request('POST', { week_start_date: '2026-08-03' }), result.res);
    expect(result.captured.statusCode).toBe(405);
    expect(mocks.getPeriodReadiness).not.toHaveBeenCalled();
  });

  it('returns the exact invalid-week error instead of a generic server failure', async () => {
    const PeriodError = (await import('@/modules/attendance/workflow/periodQueries')).AttendancePeriodError;
    mocks.getPeriodReadiness.mockRejectedValueOnce(new PeriodError('invalid date'));
    const { res, captured } = response();
    await handler(request('GET', { week_start_date: '2026-08-04' }), res);
    expect(captured.statusCode).toBe(400);
  });
});

function request(method: string, query: Record<string, string>): NextApiRequest {
  return { method, query, body: {}, headers: {}, user: { id: 'hr-1', role: 'admin' } } as unknown as NextApiRequest;
}

function response() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    send(body: unknown) { captured.body = body; return this; },
    setHeader() { return this; }, getHeader() { return undefined; },
  } as unknown as NextApiResponse;
  return { res, captured };
}
