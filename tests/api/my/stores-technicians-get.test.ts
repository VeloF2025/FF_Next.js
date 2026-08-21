/**
 * GET /api/my/stores/technicians — the roster behind the "issue stock to" picker.
 *
 * Covers the wiring the pure staffSite tests cannot reach: how query params
 * become SQL parameters, and how rows become site annotations. A bug here
 * (an empty filter matching nobody, or assigned/declared swapped) produces a
 * picker that is silently wrong rather than one that errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

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
  requireStoresActor: vi.fn(async () => ({
    staffId: 'stores-staff-1', staffRole: 'stores', authRole: null, name: 'Store Man',
  })),
}));

import handler from '../../../pages/api/my/stores/technicians';

const POP1 = '7d8b94d6-8e5a-4dbb-9ede-69ce3884e004';
const LAWLEY = '9c1f2e3a-4b5c-4d6e-8f70-112233445566';
const TEMBISA_STORE = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233';

function makeRes() {
  const res = {} as NextApiResponse & { statusCode?: number; jsonData?: Record<string, unknown> };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; }) as NextApiResponse['status'];
  res.json = vi.fn((d) => { res.jsonData = d; return res; }) as NextApiResponse['json'];
  res.setHeader = vi.fn(() => res) as unknown as NextApiResponse['setHeader'];
  return res;
}
const makeGet = (query: Record<string, string>) =>
  ({ method: 'GET', query, body: {} }) as unknown as NextApiRequest;

/**
 * Parameters of the roster query, by NAME rather than by index.
 *
 * The template interpolates each filter TWICE (once for the IS NULL branch,
 * once for the comparison), so the positional layout is
 * [roles, roles, accountStatus, accountStatus]. Asserting on a bare index is
 * how a test ends up reading the roles slot while claiming to check
 * accountStatus — which it then passes, for the wrong reason.
 */
function rosterParams() {
  const call = mockSql.mock.calls.find((c) => String(c[0]).includes('FROM staff s'));
  const p = call ? call.slice(1) : [];
  return {
    roles: p[0], rolesRepeat: p[1],
    accountStatus: p[2], accountStatusRepeat: p[3],
    all: p,
  };
}

const STAFF_ROW = {
  id: 's1', first_name: 'Semenya', last_name: 'Mokoena', phone: '0820000000',
  email: 's@phone.local', role: 'casual', account_status: 'active',
  created_by_staff_id: null, created_at: '2026-08-15',
  assigned_project_id: null, assigned_project_name: null,
  declared_project_id: POP1, declared_project_name: 'Thembisa POP 1',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/my/stores/technicians — filters', () => {
  it('passes both roles through as an array parameter', async () => {
    mockSql.mockResolvedValueOnce([STAFF_ROW]);
    await handler(makeGet({ roles: 'technician,casual' }), makeRes());
    // Casuals must be in the request. Requesting technicians only is the bug
    // that made all ten casuals un-issuable.
    const p = rosterParams();
    expect(p.roles).toEqual(['technician', 'casual']);
    expect(p.rolesRepeat).toEqual(['technician', 'casual']);
  });

  it('treats an EMPTY roles list as no filter, not as "match nobody"', async () => {
    mockSql.mockResolvedValueOnce([STAFF_ROW]);
    await handler(makeGet({ roles: ',  ,' }), makeRes());
    // `role = ANY(ARRAY[]::text[])` is false for every row: the caller would
    // get an empty roster and no error. null takes the IS NULL branch instead.
    const p = rosterParams();
    expect(p.roles).toBeNull();
    expect(p.rolesRepeat).toBeNull();
  });

  it('treats an EMPTY accountStatus as no filter, not as "match nobody"', async () => {
    mockSql.mockResolvedValueOnce([STAFF_ROW]);
    await handler(makeGet({ accountStatus: '' }), makeRes());
    // '' is not nullish, so `?? null` keeps it and `account_status = ''`
    // matches nobody.
    const p = rosterParams();
    expect(p.accountStatus).toBeNull();
    expect(p.accountStatusRepeat).toBeNull();
  });

  it('still honours a real accountStatus filter', async () => {
    mockSql.mockResolvedValueOnce([STAFF_ROW]);
    await handler(makeGet({ accountStatus: 'active' }), makeRes());
    const p = rosterParams();
    expect(p.accountStatus).toBe('active');
    expect(p.accountStatusRepeat).toBe('active');
  });

  it('accepts the legacy single role param', async () => {
    mockSql.mockResolvedValueOnce([STAFF_ROW]);
    await handler(makeGet({ role: 'technician' }), makeRes());
    expect(rosterParams().roles).toEqual(['technician']);
  });
});

describe('GET /api/my/stores/technicians — site annotation', () => {
  it('marks a person at the store’s own site as a match', async () => {
    mockSql
      .mockResolvedValueOnce([{ project_id: POP1 }]) // store lookup
      .mockResolvedValueOnce([STAFF_ROW]);
    const res = makeRes();
    await handler(makeGet({ roles: 'casual', storeLocationId: TEMBISA_STORE }), res);
    const rows = res.jsonData?.data as Array<Record<string, unknown>>;
    expect(rows[0].site_match).toBe('match');
    expect(rows[0].site_project_name).toBe('Thembisa POP 1');
    expect(rows[0].site_source).toBe('declared');
  });

  it('marks a person from another site as elsewhere', async () => {
    mockSql
      .mockResolvedValueOnce([{ project_id: LAWLEY }])
      .mockResolvedValueOnce([STAFF_ROW]);
    const res = makeRes();
    await handler(makeGet({ roles: 'casual', storeLocationId: TEMBISA_STORE }), res);
    const rows = res.jsonData?.data as Array<Record<string, unknown>>;
    expect(rows[0].site_match).toBe('elsewhere');
  });

  it('prefers the admin assignment over the self-declaration', async () => {
    mockSql
      .mockResolvedValueOnce([{ project_id: LAWLEY }])
      .mockResolvedValueOnce([{
        ...STAFF_ROW,
        assigned_project_id: LAWLEY, assigned_project_name: 'Lawley',
      }]);
    const res = makeRes();
    await handler(makeGet({ roles: 'casual', storeLocationId: TEMBISA_STORE }), res);
    const rows = res.jsonData?.data as Array<Record<string, unknown>>;
    // Declared says POP 1, assigned says Lawley, store is Lawley. Only an
    // implementation that honours the assignment returns 'match' here — one
    // that read the declaration would say 'elsewhere'.
    expect(rows[0].site_match).toBe('match');
    expect(rows[0].site_source).toBe('assigned');
    expect(rows[0].site_project_name).toBe('Lawley');
  });

  it('does not query the store when no location is supplied', async () => {
    mockSql.mockResolvedValueOnce([STAFF_ROW]);
    const res = makeRes();
    await handler(makeGet({ roles: 'casual' }), res);
    const rows = res.jsonData?.data as Array<Record<string, unknown>>;
    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(rows[0].site_match).toBe('unmapped-store');
  });

  it('ignores a malformed storeLocationId instead of passing it to Postgres', async () => {
    mockSql.mockResolvedValueOnce([STAFF_ROW]);
    const res = makeRes();
    await handler(makeGet({ roles: 'casual', storeLocationId: "not-a-uuid' OR 1=1--" }), res);
    // No store lookup ran, so the injection-shaped value never reached a query.
    expect(mockSql).toHaveBeenCalledTimes(1);
    const rows = res.jsonData?.data as Array<Record<string, unknown>>;
    expect(rows[0].site_match).toBe('unmapped-store');
  });

  it('reports an unmapped store as unmapped, not as elsewhere', async () => {
    mockSql
      .mockResolvedValueOnce([{ project_id: null }]) // store exists, no project
      .mockResolvedValueOnce([STAFF_ROW]);
    const res = makeRes();
    await handler(makeGet({ roles: 'casual', storeLocationId: TEMBISA_STORE }), res);
    const rows = res.jsonData?.data as Array<Record<string, unknown>>;
    // Every warehouse was in this state before migration 514. Returning
    // 'elsewhere' here would hide everyone and make stock un-issuable.
    expect(rows[0].site_match).toBe('unmapped-store');
  });
});
