import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ permission: true, calls: [] as Array<[string, string]>, roster: vi.fn(), options: vi.fn(), scope: vi.fn(), authorizedIds: vi.fn(), staff: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/auth/middleware', () => ({ withAuth: (handler: unknown) => handler, withPermission: (key: string, action: string) => (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => async (req: NextApiRequest, res: NextApiResponse) => { mocks.calls.push([key, action]); return mocks.permission ? handler(req, res) : res.status(403).json({ success: false }); } }));
vi.mock('@/modules/fleet/assignments/rosterQueries', () => ({ listAssignmentRoster: mocks.roster, listAssignmentOptions: mocks.options }));
vi.mock('@/modules/fleet/assignments/projectScope', () => ({ canViewAssignmentProject: mocks.scope, authorizedAssignmentProjectIds: mocks.authorizedIds }));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));
import assignmentsHandler from '../index';
import optionsHandler from '../options';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const SITE = '55555555-5555-4555-8555-555555555555';
async function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, query: Record<string, string> = {}) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = { status(code: number) { state.status = code; return res; }, json(body: unknown) { state.body = body; return res; }, setHeader(name: string, value: string) { state.headers[name] = value; return res; } } as unknown as NextApiResponse;
  await handler({ method, query, user: { id: USER, role: 'manager' } } as unknown as NextApiRequest, res);
  return state;
}
beforeEach(() => { vi.clearAllMocks(); mocks.permission = true; mocks.calls.length = 0; mocks.staff.mockResolvedValue(STAFF); mocks.scope.mockResolvedValue(true); mocks.authorizedIds.mockResolvedValue([PROJECT]); mocks.roster.mockResolvedValue({ items: [], total: 0 }); mocks.options.mockResolvedValue({ staff: [], projects: [], sites: [], vehicles: [] }); mocks.query.mockResolvedValue([{ id: PROJECT }]); });

describe('assignment read APIs', () => {
  it('allows GET only and requires fleet assignment view permission', async () => {
    const method = await call(assignmentsHandler, 'POST');
    expect(method.status).toBe(405); expect(method.headers.Allow).toBe('GET'); expect(mocks.calls).toEqual([]);
    mocks.permission = false;
    expect((await call(assignmentsHandler, 'GET', { projectId: PROJECT })).status).toBe(403);
    expect(mocks.calls).toEqual([['fleet.assignments', 'view']]);
  });

  it('rejects invalid roster filters before querying assignments', async () => {
    expect((await call(assignmentsHandler, 'GET', { projectId: 'bad' })).status).toBe(400);
    expect((await call(assignmentsHandler, 'GET', { projectId: PROJECT, from: '2026-14-01' })).status).toBe(400);
    expect((await call(assignmentsHandler, 'GET', { projectId: PROJECT, siteId: 'bad' })).status).toBe(400);
    expect((await call(assignmentsHandler, 'GET', { projectId: PROJECT, from: '2025-01-01', to: '2026-01-03' })).status).toBe(400);
    expect((await call(assignmentsHandler, 'GET', { projectId: PROJECT, source: 'unknown', page: '0', limit: '101' })).status).toBe(400);
    expect(mocks.roster).not.toHaveBeenCalled();
  });

  it('does not return roster data outside the project scope', async () => {
    mocks.scope.mockResolvedValue(false);
    expect((await call(assignmentsHandler, 'GET', { projectId: PROJECT })).status).toBe(403);
    expect(mocks.roster).not.toHaveBeenCalled();
  });

  it('passes authorized roster filters with offset pagination', async () => {
    await call(assignmentsHandler, 'GET', { projectId: PROJECT, staffId: STAFF, siteId: SITE, from: '2026-08-01', to: '2026-08-31', source: 'roster', page: '2', limit: '10' });
    expect(mocks.scope).toHaveBeenCalledWith(USER, STAFF, 'manager', PROJECT);
    expect(mocks.roster).toHaveBeenCalledWith({ projectId: PROJECT, staffId: STAFF, siteId: SITE, startDate: '2026-08-01', endDate: '2026-08-31', source: 'roster', unassignedScheduled: false, limit: 10, offset: 10 });
  });

  // Scoping is now resolved in one batched call instead of a per-project loop.
  // The allow/deny rules themselves are covered in projectScope.test.ts; what
  // matters here is that the route asks for 'view' and forwards exactly the set
  // it is given, without widening it.
  it('only exposes options for active projects in the user view scope', async () => {
    mocks.authorizedIds.mockResolvedValue([PROJECT]);
    await call(optionsHandler, 'GET');
    expect(mocks.authorizedIds).toHaveBeenCalledWith(USER, STAFF, 'manager', 'view');
    expect(mocks.options).toHaveBeenCalledWith({}, [PROJECT]);
    expect(mocks.options.mock.calls[0]![1]).not.toContain(OTHER);
  });

  it('forwards an empty scope rather than falling back to every project', async () => {
    mocks.authorizedIds.mockResolvedValue([]);
    await call(optionsHandler, 'GET');
    expect(mocks.options).toHaveBeenCalledWith({}, []);
  });

  it('validates and passes the requested option date range', async () => {
    expect((await call(optionsHandler, 'GET', { from: '2026-14-01' })).status).toBe(400);
    expect((await call(optionsHandler, 'GET', { from: '2025-01-01', to: '2026-01-03' })).status).toBe(400);
    expect(mocks.options).not.toHaveBeenCalled();

    await call(optionsHandler, 'GET', { projectId: PROJECT, from: '2026-08-01', to: '2026-08-31' });
    expect(mocks.options).toHaveBeenCalledWith(
      { projectId: PROJECT, startDate: '2026-08-01', endDate: '2026-08-31' },
      [PROJECT],
    );
  });
});
