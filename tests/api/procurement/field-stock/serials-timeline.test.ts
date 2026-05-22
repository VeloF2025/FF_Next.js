/**
 * Unit tests for GET /api/procurement/field-stock/serials/timeline.
 *
 * Exercises the HTTP boundary only — the service layer is mocked so we can
 * assert all 4xx/5xx paths and the success envelope independently. Real-DB
 * integration coverage lives at
 * tests/db/services/field-stock/serialTimeline.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { getSerialTimelineMock } = vi.hoisted(() => ({ getSerialTimelineMock: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/procurement/field-stock/services/serialTimelineService', () => ({
  getSerialTimeline: getSerialTimelineMock,
}));

import handler from '../../../../pages/api/procurement/field-stock/serials/timeline';

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

function makeReq(method: string, query: Record<string, string | string[]> = {}): NextApiRequest {
  return { method, query, headers: {} } as unknown as NextApiRequest;
}

const SAMPLE_RESULT = {
  serial: {
    id: 'serial-1',
    serialNumber: 'PR9A-X',
    macAddress: null,
    category: null,
    itemName: null,
    status: 'available',
    currentLocationName: null,
    allocatedProjectName: null,
    installedAtDropNumber: null,
    installedDate: null,
    receivedDate: null,
    activatedAtOltId: null,
  },
  entries: [],
  hasRealEvents: false,
};

describe('GET /api/procurement/field-stock/serials/timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with apiResponse.success envelope on happy path', async () => {
    getSerialTimelineMock.mockResolvedValueOnce(SAMPLE_RESULT);
    const res = makeRes();
    await handler(makeReq('GET', { serialNumber: 'PR9A-X' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: SAMPLE_RESULT });
    expect(getSerialTimelineMock).toHaveBeenCalledWith('PR9A-X');
  });

  it('trims whitespace from serialNumber before lookup', async () => {
    getSerialTimelineMock.mockResolvedValueOnce(SAMPLE_RESULT);
    await handler(makeReq('GET', { serialNumber: '  PR9A-X  ' }), makeRes());
    expect(getSerialTimelineMock).toHaveBeenCalledWith('PR9A-X');
  });

  it('rejects non-GET methods with 405', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { serialNumber: 'PR9A-X' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers!['Allow']).toBe('GET');
    expect(getSerialTimelineMock).not.toHaveBeenCalled();
  });

  it('rejects missing serialNumber with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.jsonData)).toContain('serialNumber');
    expect(getSerialTimelineMock).not.toHaveBeenCalled();
  });

  it('rejects empty serialNumber with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { serialNumber: '   ' }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.jsonData)).toContain('empty');
    expect(getSerialTimelineMock).not.toHaveBeenCalled();
  });

  it('rejects array serialNumber with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { serialNumber: ['a', 'b'] }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.jsonData)).toContain('serialNumber');
    expect(getSerialTimelineMock).not.toHaveBeenCalled();
  });

  it('rejects serialNumber > 100 chars with 400', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { serialNumber: 'X'.repeat(101) }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.jsonData)).toContain('100');
    expect(getSerialTimelineMock).not.toHaveBeenCalled();
  });

  it('accepts serialNumber exactly 100 chars', async () => {
    getSerialTimelineMock.mockResolvedValueOnce(SAMPLE_RESULT);
    const res = makeRes();
    await handler(makeReq('GET', { serialNumber: 'X'.repeat(100) }), res);
    expect(res.statusCode).toBe(200);
    expect(getSerialTimelineMock).toHaveBeenCalledWith('X'.repeat(100));
  });

  it('returns 404 when service resolves null', async () => {
    getSerialTimelineMock.mockResolvedValueOnce(null);
    const res = makeRes();
    await handler(makeReq('GET', { serialNumber: 'PR9A-MISSING' }), res);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.jsonData)).toContain('PR9A-MISSING');
  });

  it('returns 500 envelope when service throws', async () => {
    getSerialTimelineMock.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();
    await handler(makeReq('GET', { serialNumber: 'PR9A-X' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonData).toMatchObject({ success: false });
  });
});
