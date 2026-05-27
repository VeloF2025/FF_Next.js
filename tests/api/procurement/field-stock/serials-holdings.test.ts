/**
 * Unit tests for the holdings list APIs (warehouses + projects). Service layer
 * is mocked — we assert the success envelope, 405, and 500 paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { listWarehousesMock, listProjectsMock } = vi.hoisted(() => ({
  listWarehousesMock: vi.fn(),
  listProjectsMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/procurement/field-stock/services/serialHoldingsService', () => ({
  listWarehousesWithSerials: listWarehousesMock,
  listProjectsWithSerials: listProjectsMock,
}));

import warehousesHandler from '../../../../pages/api/procurement/field-stock/serials/warehouses';
import projectsHandler from '../../../../pages/api/procurement/field-stock/serials/projects';

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

function makeReq(method: string): NextApiRequest {
  return { method, query: {}, headers: {} } as unknown as NextApiRequest;
}

describe('GET /api/procurement/field-stock/serials/warehouses', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with the rows envelope', async () => {
    listWarehousesMock.mockResolvedValueOnce([
      { id: 'w1', name: 'Main', code: 'WH-1', locationType: 'warehouse', serialCount: 5 },
    ]);
    const res = makeRes();
    await warehousesHandler(makeReq('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: { rows: [{ id: 'w1', serialCount: 5 }] } });
  });

  it('rejects non-GET with 405', async () => {
    const res = makeRes();
    await warehousesHandler(makeReq('POST'), res);
    expect(res.statusCode).toBe(405);
    expect(listWarehousesMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the service throws', async () => {
    listWarehousesMock.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();
    await warehousesHandler(makeReq('GET'), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonData).toMatchObject({ success: false });
  });

  it('returns 200 with an empty rows array when nothing holds serials', async () => {
    listWarehousesMock.mockResolvedValueOnce([]);
    const res = makeRes();
    await warehousesHandler(makeReq('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: { rows: [] } });
  });
});

describe('GET /api/procurement/field-stock/serials/projects', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with the rows envelope', async () => {
    listProjectsMock.mockResolvedValueOnce([{ id: 'p1', projectName: 'Lawley', serialCount: 9 }]);
    const res = makeRes();
    await projectsHandler(makeReq('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: { rows: [{ id: 'p1', serialCount: 9 }] } });
  });

  it('rejects non-GET with 405', async () => {
    const res = makeRes();
    await projectsHandler(makeReq('DELETE'), res);
    expect(res.statusCode).toBe(405);
    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  it('returns 500 with a success:false body when the service throws', async () => {
    listProjectsMock.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();
    await projectsHandler(makeReq('GET'), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonData).toMatchObject({ success: false });
  });
});
