import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';

const { getSummaryMock } = vi.hoisted(() => ({ getSummaryMock: vi.fn() }));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h, withPermission: () => (h: unknown) => h }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/procurement/field-stock/services/dashboardV2Service', () => ({
  getDashboardV2Summary: getSummaryMock,
}));

import handler from '../../../../pages/api/procurement/field-stock/dashboard-v2';

interface CapturedRes extends Partial<NextApiResponse> { statusCode?: number; jsonData?: unknown; }
function makeRes(): NextApiResponse & CapturedRes {
  const res: CapturedRes = {};
  res.status = vi.fn((c: number) => { res.statusCode = c; return res as NextApiResponse; });
  res.json = vi.fn((d: unknown) => { res.jsonData = d; return res as NextApiResponse; });
  res.setHeader = vi.fn(() => res as NextApiResponse);
  return res as NextApiResponse & CapturedRes;
}
function makeReq(method: string): NextApiRequest {
  return { method, query: {}, headers: {} } as unknown as NextApiRequest;
}

describe('GET /api/procurement/field-stock/dashboard-v2', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with the summary on happy path', async () => {
    const summary = { stockValue: { total: 1, byLocation: [] }, contractorExposure: { totalHeldValue: 0, totalUnaccountedValue: 0, totalPendingRecovery: 0, blockedCount: 0, top: [] }, serialsLifecycle: { byStatus: {}, installed: 0, activated: 0, recentlyInstalled: 0, recentlyActivated: 0 }, ageing: { thresholdDays: 30, stagnantStockCount: 0, stagnantStockValue: 0, serialsIssuedNotInstalled: 0 } };
    getSummaryMock.mockResolvedValueOnce(summary);
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: { stockValue: { total: 1 } } });
  });

  it('rejects non-GET with 405', async () => {
    const res = makeRes();
    await handler(makeReq('POST'), res);
    expect(res.statusCode).toBe(405);
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
  });

  it('returns 500 when the service throws', async () => {
    getSummaryMock.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(500);
    expect(log.error).toHaveBeenCalledWith('Field stock dashboard v2 API error', expect.objectContaining({ error: expect.any(Error) }), 'field-stock/dashboard-v2');
  });
});
