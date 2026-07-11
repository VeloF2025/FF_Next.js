/**
 * Tests for GET /api/my/stores/serials/[serialNumber] — currentLocationName
 * enrichment. The scan step cross-checks the serial's warehouse against the
 * selected source and needs the location's display name.
 */

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// Bypass /my auth: run the inner handler with an injected session.
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession: (h: unknown) => (req: unknown, res: unknown) =>
    (h as (r: unknown, s: unknown, sess: unknown) => unknown)(req, res, { staffId: 'staff-1' }),
}));
vi.mock('@/modules/field-stock-pwa/lib/storesActor', () => ({
  requireStoresActor: vi.fn(async () => ({ staffId: 'staff-1', role: 'stores' })),
}));
vi.mock('@/modules/procurement/field-stock/services/serialService', () => ({
  getSerialByNumber: vi.fn(),
  getSerialById: vi.fn(),
  getSerialHistory: vi.fn(),
}));
vi.mock('@/lib/db-pool', () => ({ sql: vi.fn() }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { getSerialByNumber } from '@/modules/procurement/field-stock/services/serialService';
import handler from '../[serialNumber]';

const sqlMock = vi.mocked(sql);
const getSerialByNumberMock = vi.mocked(getSerialByNumber);

function run(serialNumber: string) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'GET',
    query: { serialNumber },
  });
  return (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(
    req,
    res
  ).then(() => res);
}

const BASE_SERIAL = {
  id: 'uuid-1',
  stockItemId: 'item-ont',
  serialNumber: 'ALCLB465A813',
  status: 'in_stock',
};

describe('GET /api/my/stores/serials/[serialNumber] — currentLocationName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joins the location name when the serial has a location', async () => {
    getSerialByNumberMock.mockResolvedValueOnce({
      ...BASE_SERIAL,
      currentLocationId: 'loc-lawley',
    } as never);
    sqlMock.mockResolvedValueOnce([{ name: 'Lawley' }] as never);

    const res = await run('ALCLB465A813');

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData().data;
    expect(data.currentLocationId).toBe('loc-lawley');
    expect(data.currentLocationName).toBe('Lawley');
  });

  it('returns null name when the location row is missing', async () => {
    getSerialByNumberMock.mockResolvedValueOnce({
      ...BASE_SERIAL,
      currentLocationId: 'loc-gone',
    } as never);
    sqlMock.mockResolvedValueOnce([] as never);

    const res = await run('ALCLB465A813');

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.currentLocationName).toBeNull();
  });

  it('skips the lookup entirely when the serial has no location', async () => {
    getSerialByNumberMock.mockResolvedValueOnce({
      ...BASE_SERIAL,
      currentLocationId: null,
    } as never);

    const res = await run('ALCLB465A813');

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.currentLocationName).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
