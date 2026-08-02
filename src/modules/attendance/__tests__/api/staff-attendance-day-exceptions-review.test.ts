import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ decideDayException: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth/middleware', () => ({ withAuth: (h: unknown) => h, withPermission: () => (h: unknown) => h }));
vi.mock('@/modules/attendance/workflow/dayExceptionQueries', () => ({
  DayExceptionWorkflowError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  decideDayException: mocks.decideDayException,
}));

import handler from '../../../../../pages/api/staff/attendance-day-exceptions-review';

const EXCEPTION_ID = '11111111-1111-4111-8111-111111111111';
const user = { id: 'user-1', userId: 'user-1', role: 'manager', email: 's@example.com', firstName: 'S',
  lastName: 'V', name: 'S V', permissions: [], isActive: true };
const hours = { regular: 8, overtime: 0, sunday: 0, holiday: 0, leave: 0, unpaid: 0 };
function req(body: Record<string, unknown> = {}, method = 'POST') {
  return { method, query: {}, body, headers: {}, user } as unknown as NextApiRequest;
}
function response() {
  const captured: { status: number; body?: unknown } = { status: 200 };
  const res = { status(code: number) { captured.status = code; return this; }, json(body: unknown) { captured.body = body; return this; },
    setHeader: vi.fn() } as unknown as NextApiResponse;
  return { res, captured };
}
const valid = { exception_id: EXCEPTION_ID, expected_result_version: 4, action: 'approve', approved_hours: hours,
  reason: 'Confirmed against site close record' };

beforeEach(() => vi.clearAllMocks());

describe('POST /api/staff/attendance-day-exceptions-review', () => {
  it('rejects unsupported methods', async () => {
    const { res, captured } = response(); await handler(req({}, 'GET'), res); expect(captured.status).toBe(405);
  });
  it.each([
    [{ ...valid, exception_id: '' }, 'exception'], [{ ...valid, expected_result_version: 0 }, 'version'],
    [{ ...valid, action: 'delete' }, 'action'], [{ ...valid, reason: '   ' }, 'reason'],
    [{ ...valid, approved_hours: { ...hours, regular: Number.NaN } }, 'hours'],
  ])('returns 400 for invalid %s', async (body) => {
    const { res, captured } = response(); await handler(req(body), res); expect(captured.status).toBe(400);
    expect(mocks.decideDayException).not.toHaveBeenCalled();
  });

  it('returns the persisted decision read-back', async () => {
    mocks.decideDayException.mockResolvedValue({ exception: { id: EXCEPTION_ID, status: 'resolved' }, dailyResult: { resultVersion: 5 } });
    const { res, captured } = response(); await handler(req(valid), res);
    expect(captured.status).toBe(200);
    expect(mocks.decideDayException).toHaveBeenCalledWith(expect.objectContaining({
      exceptionId: EXCEPTION_ID, expectedResultVersion: 4, actor: user, approvedHours: hours,
    }));
  });

  it.each(['result_stale', 'already_decided', 'period_locked'])('maps %s to 409 with a business reason', async (code) => {
    mocks.decideDayException.mockRejectedValue(Object.assign(new Error(code), { code }));
    const { res, captured } = response(); await handler(req(valid), res);
    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: { details: { reason: code } } });
  });

  it('maps invalid physical hours from the workflow to 400', async () => {
    mocks.decideDayException.mockRejectedValue(Object.assign(new Error('invalid hours'), { code: 'invalid_hours' }));
    const { res, captured } = response(); await handler(req(valid), res);
    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ error: { details: { reason: 'invalid_hours' } } });
  });

  it('maps a foreign exception to IDOR-safe 404', async () => {
    mocks.decideDayException.mockRejectedValue(Object.assign(new Error('not found'), { code: 'not_found' }));
    const { res, captured } = response(); await handler(req(valid), res);
    expect(captured.status).toBe(404);
  });
});
