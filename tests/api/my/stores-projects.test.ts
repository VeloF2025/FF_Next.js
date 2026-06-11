/**
 * Tests for GET /api/my/stores/projects — the stores-PWA project list feeding
 * the issue wizard's project picker (Tier 2 accountability project dimension).
 *
 * Gated by withMySession + requireStoresActor; reads `projects` via pg.Pool
 * (@/lib/db-pool tagged template). Both are stubbed here so the test exercises
 * only the handler's method routing + shape mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockSql, requireStoresActor } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  requireStoresActor: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => {
  const sql = (...args: unknown[]) => mockSql(...args);
  sql.query = (...args: unknown[]) => mockSql(...args);
  return { sql };
});
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (handler: (req: NextApiRequest, res: NextApiResponse, session: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, { staffId: 'stores-staff-1', staffName: 'Store Man' }),
}));
vi.mock('@/modules/field-stock-pwa/lib/storesActor', () => ({
  requireStoresActor: (...args: unknown[]) => requireStoresActor(...args),
}));

import handler from '../../../pages/api/my/stores/projects';

const STORES_ACTOR = { staffId: 'stores-staff-1', staffRole: 'stores', authRole: null, name: 'Store Man' };

const PROJECTS = [
  { id: 'p-1', project_name: 'Mohadin', project_code: 'MOH', status: 'active' },
  { id: 'p-2', project_name: "Themb'elihle", project_code: 'THM', status: 'active' },
];

function makeRes() {
  const res = {} as NextApiResponse & { statusCode?: number; jsonData?: Record<string, unknown> };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as NextApiResponse['status'];
  res.json = vi.fn((data) => {
    res.jsonData = data;
    return res;
  }) as NextApiResponse['json'];
  res.setHeader = vi.fn(() => res) as unknown as NextApiResponse['setHeader'];
  return res;
}

function makeReq(method: string, query: Record<string, unknown> = {}): NextApiRequest {
  return { method, query, body: {} } as unknown as NextApiRequest;
}

describe('GET /api/my/stores/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireStoresActor.mockResolvedValue(STORES_ACTOR);
  });

  it('returns active projects for a stores actor', async () => {
    mockSql.mockResolvedValueOnce(PROJECTS);
    const res = makeRes();
    await handler(makeReq('GET'), res);

    expect(res.statusCode).toBe(200);
    const data = res.jsonData?.data as typeof PROJECTS;
    expect(data).toHaveLength(2);
    expect(data[0]!.id).toBe('p-1');
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('passes a search term through to the query', async () => {
    mockSql.mockResolvedValueOnce([PROJECTS[0]]);
    const res = makeRes();
    await handler(makeReq('GET', { search: 'moh' }), res);

    expect(res.statusCode).toBe(200);
    // The search branch interpolates the %term% into the tagged-template values.
    const callArgs = mockSql.mock.calls[0] as unknown[];
    const flattened = JSON.stringify(callArgs);
    expect(flattened).toContain('%moh%');
  });

  it('rejects non-GET methods with 405', async () => {
    const res = makeRes();
    await handler(makeReq('POST'), res);
    expect(res.statusCode).toBe(405);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('does not run the query when the stores-actor gate fails', async () => {
    // requireStoresActor writes the 403 itself and returns null.
    requireStoresActor.mockImplementationOnce(async (res: NextApiResponse) => {
      (res as unknown as { statusCode: number }).statusCode = 403;
      return null;
    });
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(mockSql).not.toHaveBeenCalled();
  });
});
