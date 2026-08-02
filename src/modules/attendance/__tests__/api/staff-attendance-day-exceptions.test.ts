import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listDayExceptions: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth/middleware', () => ({ withAuth: (h: unknown) => h, withPermission: () => (h: unknown) => h }));
vi.mock('@/modules/attendance/workflow/dayExceptionQueries', () => ({ listDayExceptions: mocks.listDayExceptions }));

import handler from '../../../../../pages/api/staff/attendance-day-exceptions';

const user = { id: 'user-1', userId: 'user-1', role: 'manager', email: 's@example.com', firstName: 'S',
  lastName: 'V', name: 'S V', permissions: [], isActive: true };
function req(query: Record<string, string> = {}, method = 'GET') {
  return { method, query, body: {}, headers: {}, user } as unknown as NextApiRequest;
}
function response() {
  const captured: { status: number; body?: unknown } = { status: 200 };
  const res = { status(code: number) { captured.status = code; return this; }, json(body: unknown) { captured.body = body; return this; },
    setHeader: vi.fn() } as unknown as NextApiResponse;
  return { res, captured };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/staff/attendance-day-exceptions', () => {
  it('rejects unsupported methods', async () => {
    const { res, captured } = response(); await handler(req({}, 'POST'), res); expect(captured.status).toBe(405);
  });
  it.each([{ status: 'bogus' }, { kind: 'bogus' }, { limit: '0' }, { limit: '201' }])(
    'rejects invalid bounded filters %#', async (query) => {
      const { res, captured } = response(); await handler(req(query), res); expect(captured.status).toBe(400);
      expect(mocks.listDayExceptions).not.toHaveBeenCalled();
    });
  it('returns the scoped queue result', async () => {
    mocks.listDayExceptions.mockResolvedValue({ items: [], limit: 50, status: 'unresolved', scope: { kind: 'scoped', staffCount: 2 } });
    const { res, captured } = response(); await handler(req(), res);
    expect(captured.status).toBe(200);
    expect(mocks.listDayExceptions).toHaveBeenCalledWith({ user, status: 'unresolved', kind: undefined, limit: 50 });
  });
});
