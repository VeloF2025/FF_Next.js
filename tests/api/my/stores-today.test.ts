/**
 * Unit tests for GET /api/my/stores/today.
 *
 * Exercises the HTTP boundary only — withMySession and the service layer
 * are mocked so we can assert method-not-allowed, success envelope, error
 * path, and the date-default behaviour independently. Real-DB integration
 * coverage lives at
 * tests/db/services/field-stock-pwa/storesTodayService.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { getTodayMock, sastWorkDateMock } = vi.hoisted(() => ({
  getTodayMock: vi.fn(),
  sastWorkDateMock: vi.fn(),
}));

vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  // Pass-through wrapper that injects a stub session.
  withMySession:
    (handler: (req: NextApiRequest, res: NextApiResponse, session: { staffId: string }) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, { staffId: 'test-stores-staff' }),
}));
vi.mock('@/modules/attendance/portal/clockUtils', () => ({
  sastWorkDate: sastWorkDateMock,
}));
vi.mock('@/modules/field-stock-pwa/services/storesTodayService', () => ({
  getTodayForStoresUser: getTodayMock,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import handler from '../../../pages/api/my/stores/today';

interface CapturedRes {
  statusCode?: number;
  jsonData?: { success: boolean; data?: unknown; error?: { message?: string } };
  headers: Record<string, string>;
}

function makeRes(): NextApiResponse & CapturedRes {
  const res = { headers: {} } as NextApiResponse & CapturedRes;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as NextApiResponse['status'];
  res.json = vi.fn((data) => {
    res.jsonData = data;
    return res;
  }) as NextApiResponse['json'];
  res.setHeader = vi.fn((name: string, value: string | number | readonly string[]) => {
    res.headers[name] = String(value);
    return res;
  }) as NextApiResponse['setHeader'];
  return res;
}

function makeReq(method: string, query: Record<string, string> = {}): NextApiRequest {
  return { method, query, headers: {}, cookies: {} } as unknown as NextApiRequest;
}

beforeEach(() => {
  getTodayMock.mockReset();
  sastWorkDateMock.mockReset();
  sastWorkDateMock.mockReturnValue('2026-05-22');
});

describe('GET /api/my/stores/today', () => {
  it('returns 405 for non-GET methods', async () => {
    const res = makeRes();
    await handler(makeReq('POST'), res);
    expect(res.statusCode).toBe(405);
    expect(getTodayMock).not.toHaveBeenCalled();
  });

  it('defaults to sastWorkDate(today) when no ?date param', async () => {
    getTodayMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(sastWorkDateMock).toHaveBeenCalledOnce();
    expect(getTodayMock).toHaveBeenCalledWith('test-stores-staff', '2026-05-22');
    expect(res.statusCode).toBe(200);
    expect(res.jsonData?.success).toBe(true);
    expect((res.jsonData?.data as { date: string }).date).toBe('2026-05-22');
  });

  it('accepts valid YYYY-MM-DD ?date override', async () => {
    getTodayMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq('GET', { date: '2026-04-01' }), res);
    expect(sastWorkDateMock).not.toHaveBeenCalled();
    expect(getTodayMock).toHaveBeenCalledWith('test-stores-staff', '2026-04-01');
  });

  it('falls back to today when ?date is malformed', async () => {
    getTodayMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq('GET', { date: 'not-a-date' }), res);
    expect(sastWorkDateMock).toHaveBeenCalledOnce();
    expect(getTodayMock).toHaveBeenCalledWith('test-stores-staff', '2026-05-22');
  });

  it('returns the service rows in a success envelope', async () => {
    const fakeRows = [
      {
        technician_id: 't-1',
        technician_name: 'Sipho',
        issued_count: 3,
        issued_value_rand: 4500,
        installed_count: 1,
        returned_count: 0,
        unaccounted_count: 2,
      },
    ];
    getTodayMock.mockResolvedValueOnce(fakeRows);
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData?.success).toBe(true);
    expect(res.jsonData?.data).toEqual({ date: '2026-05-22', rows: fakeRows });
  });

  it('returns 500 when the service throws', async () => {
    getTodayMock.mockRejectedValueOnce(new Error('boom'));
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonData?.success).toBe(false);
  });
});
