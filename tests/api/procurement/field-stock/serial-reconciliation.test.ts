import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';

const { getSummaryMock, withPermissionMock } = vi.hoisted(() => ({
  getSummaryMock: vi.fn(),
  withPermissionMock: vi.fn(() => (h: unknown) => h),
}));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h, withPermission: withPermissionMock }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/procurement/field-stock/services/serialReconciliationService', () => ({
  getSerialReconciliationSummary: getSummaryMock,
}));

const SUMMARY = {
  checks: [{ name: 'latest_event_matches_status', tolerance: 0, drift: 0, passed: true }],
  ranAt: '2026-05-25T10:00:00.000Z',
  allPassed: true,
};

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
async function loadHandler() {
  vi.resetModules();
  return (await import('../../../../pages/api/procurement/field-stock/serial-reconciliation')).default;
}

describe('GET /api/procurement/field-stock/serial-reconciliation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is gated by the procurement.field-stock view permission', async () => {
    await loadHandler();
    expect(withPermissionMock).toHaveBeenCalledWith('procurement.field-stock', 'view');
  });

  it('returns 200 with the reconciliation summary on happy path', async () => {
    getSummaryMock.mockResolvedValueOnce(SUMMARY);
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: { allPassed: true } });
  });

  it('rejects non-GET with 405', async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq('POST'), res);
    expect(res.statusCode).toBe(405);
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
  });

  it('serves the second call from cache without re-running the checks', async () => {
    getSummaryMock.mockResolvedValueOnce(SUMMARY);
    const handler = await loadHandler();
    await handler(makeReq('GET'), makeRes());
    await handler(makeReq('GET'), makeRes());
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the service throws', async () => {
    getSummaryMock.mockRejectedValueOnce(new Error('db down'));
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'Serial reconciliation API error',
      expect.objectContaining({ error: expect.any(Error) }),
      'field-stock/serial-reconciliation',
    );
  });
});
