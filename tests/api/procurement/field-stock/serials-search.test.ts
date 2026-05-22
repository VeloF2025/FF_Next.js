/**
 * Unit tests for GET /api/procurement/field-stock/serials/search.
 *
 * Exercises the HTTP boundary only — the service layer is mocked so we
 * can assert all 4xx/5xx paths and the success envelope independently.
 * Real-DB integration coverage lives at
 * tests/db/services/field-stock/searchSerials.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { searchSerialsMock } = vi.hoisted(() => ({ searchSerialsMock: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/procurement/field-stock/services/serialSearchService', () => ({
  searchSerials: searchSerialsMock,
}));

import handler from '../../../../pages/api/procurement/field-stock/serials/search';

interface CapturedRes extends Partial<NextApiResponse> {
  statusCode?: number;
  jsonData?: unknown;
  headers?: Record<string, string>;
}

function makeRes(): NextApiResponse & CapturedRes {
  const res: CapturedRes = { headers: {} };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as NextApiResponse;
  });
  res.json = vi.fn((data: unknown) => {
    res.jsonData = data;
    return res as NextApiResponse;
  });
  res.setHeader = vi.fn((name: string, value: string | number | readonly string[]) => {
    res.headers![name] = String(value);
    return res as NextApiResponse;
  });
  return res as NextApiResponse & CapturedRes;
}

function makeReq(method: string, query: Record<string, string> = {}): NextApiRequest {
  return { method, query, headers: {} } as unknown as NextApiRequest;
}

describe('GET /api/procurement/field-stock/serials/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with apiResponse.success envelope on happy path', async () => {
    searchSerialsMock.mockResolvedValueOnce({
      rows: [{ id: 'r1', serialNumber: 'PR8-X', macAddress: null, category: null, itemName: null, status: 'available', currentLocationName: null, allocatedProjectName: null, installedAtDropNumber: null, lastEventType: null, lastEventAt: null }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    const req = makeReq('GET', { q: 'PR8-' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: { total: 1, page: 1, pageSize: 50 } });
    expect(searchSerialsMock).toHaveBeenCalledWith({ q: 'PR8-' }, { page: 1, pageSize: 50 });
  });

  it('parses status as comma-separated array', async () => {
    searchSerialsMock.mockResolvedValueOnce({ rows: [], total: 0, page: 1, pageSize: 50 });
    await handler(makeReq('GET', { status: 'available,installed' }), makeRes());
    expect(searchSerialsMock).toHaveBeenCalledWith(
      { status: ['available', 'installed'] },
      { page: 1, pageSize: 50 }
    );
  });

  it('rejects non-GET methods with 405', async () => {
    const res = makeRes();
    await handler(makeReq('POST'), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers!['Allow']).toBe('GET');
    expect(searchSerialsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed warehouseId with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { warehouseId: 'not-a-uuid' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonData).toMatchObject({ success: false });
    expect(JSON.stringify(res.jsonData)).toContain('warehouseId');
    expect(searchSerialsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed projectId with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { projectId: 'xyz' }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.jsonData)).toContain('projectId');
    expect(searchSerialsMock).not.toHaveBeenCalled();
  });

  it('accepts a valid UUID warehouseId', async () => {
    searchSerialsMock.mockResolvedValueOnce({ rows: [], total: 0, page: 1, pageSize: 50 });
    const validUuid = 'aaaaaaaa-0000-0000-0000-000000000003';
    await handler(makeReq('GET', { warehouseId: validUuid }), makeRes());
    expect(searchSerialsMock).toHaveBeenCalledWith(
      { warehouseId: validUuid },
      { page: 1, pageSize: 50 }
    );
  });

  it('rejects non-integer page with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { page: 'abc' }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.jsonData)).toContain('page');
    expect(searchSerialsMock).not.toHaveBeenCalled();
  });

  it('rejects mixed-numeric page (e.g. "5xyz") with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { page: '5xyz' }), res);
    expect(res.statusCode).toBe(400);
    expect(searchSerialsMock).not.toHaveBeenCalled();
  });

  it('rejects pageSize above MAX (200) with 400, not silent clamp', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { pageSize: '99999' }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.jsonData)).toContain('pageSize');
    expect(searchSerialsMock).not.toHaveBeenCalled();
  });

  it('rejects pageSize 0 with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { pageSize: '0' }), res);
    expect(res.statusCode).toBe(400);
    expect(searchSerialsMock).not.toHaveBeenCalled();
  });

  it('rejects page 0 with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { page: '0' }), res);
    expect(res.statusCode).toBe(400);
    expect(searchSerialsMock).not.toHaveBeenCalled();
  });

  it('returns 500 envelope when searchSerials throws', async () => {
    searchSerialsMock.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();
    await handler(makeReq('GET', {}), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonData).toMatchObject({ success: false });
  });

  it('trims whitespace from q and drops empty', async () => {
    searchSerialsMock.mockResolvedValueOnce({ rows: [], total: 0, page: 1, pageSize: 50 });
    await handler(makeReq('GET', { q: '   ' }), makeRes());
    expect(searchSerialsMock).toHaveBeenCalledWith({}, { page: 1, pageSize: 50 });
  });

  it('accepts valid pagination', async () => {
    searchSerialsMock.mockResolvedValueOnce({ rows: [], total: 0, page: 3, pageSize: 25 });
    await handler(makeReq('GET', { page: '3', pageSize: '25' }), makeRes());
    expect(searchSerialsMock).toHaveBeenCalledWith({}, { page: 3, pageSize: 25 });
  });
});
