import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  roster: vi.fn(), overview: vi.fn(), overlay: vi.fn(), project: vi.fn(), projectOptions: vi.fn(), staff: vi.fn(),
  permissions: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) =>
    (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => {
      mocks.permissions.push([key, action]); return handler;
    },
}));
vi.mock('@/modules/fleet/operations/statusService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/operations/statusService')>('@/modules/fleet/operations/statusService');
  return { ...actual, getOperationalRosterStatus: mocks.roster };
});
vi.mock('@/modules/fleet/operations/overviewService', () => ({ buildOperationalOverview: mocks.overview }));
vi.mock('@/modules/fleet/operations/mapOverlayService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/operations/mapOverlayService')>('@/modules/fleet/operations/mapOverlayService');
  return { ...actual, getOperationalMapOverlay: mocks.overlay };
});
vi.mock('@/modules/fleet/operations/projectScope', () => ({
  canAccessOperationalProject: mocks.project,
  listOperationalProjectOptions: mocks.projectOptions,
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));

import overviewHandler from '@/pages/api/fleet/operations/overview';
import overlayHandler from '@/pages/api/fleet/operations/map-overlay';
import projectOptionsHandler from '@/pages/api/fleet/operations/project-options';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SITE = '44444444-4444-4444-8444-444444444444';
const valid = { projectId: PROJECT, workDate: '2026-08-14', asOf: '2026-08-14T08:00:00.000Z' };

async function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string,
  query: Record<string, string | string[]>) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = { status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; } } as unknown as NextApiResponse;
  await handler({ method, query, user: { id: USER, role: 'manager' } } as unknown as NextApiRequest, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.staff.mockResolvedValue(STAFF); mocks.project.mockResolvedValue(true);
  mocks.roster.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, hasMore: false });
  mocks.overview.mockReturnValue({ selectionState: 'no_scheduled_staff', groups: [], attention: { items: [], page: 1,
    limit: 25, total: 0, hasMore: false }, roster: { page: 1, limit: 100, total: 0, hasMore: false } });
  mocks.overlay.mockResolvedValue({ badges: [], attendancePoints: [], unplottable: [], page: 1, limit: 25,
    total: 0, hasMore: false, workDate: valid.workDate, evaluatedAt: valid.asOf });
  mocks.projectOptions.mockResolvedValue([{ id: PROJECT, label: 'Managed Project' }]);
});

describe('operational presentation APIs', () => {
  it('allows GET only and applies the operations-status view permission to both routes', async () => {
    for (const handler of [overviewHandler, overlayHandler, projectOptionsHandler]) {
      const result = await call(handler, 'POST', {}); expect(result.status).toBe(405); expect(result.headers.Allow).toBe('GET');
    }
    await call(overviewHandler, 'GET', valid); await call(overlayHandler, 'GET', valid);
    expect(mocks.permissions).toEqual([
      ['fleet.operations-status', 'view'], ['fleet.operations-status', 'view'],
      ['fleet.operations-status', 'view'],
    ]);
  });

  it('serves project-manager options from operations-status scope without assignments permission', async () => {
    const result = await call(projectOptionsHandler, 'GET', {});

    expect(result.status).toBe(200);
    expect(mocks.staff).toHaveBeenCalledWith(USER);
    expect(mocks.projectOptions).toHaveBeenCalledWith(USER, STAFF, 'manager');
    expect(result.body).toMatchObject({ success: true, data: [{ id: PROJECT, label: 'Managed Project' }] });
    expect(mocks.permissions).toContainEqual(['fleet.operations-status', 'view']);
    expect(mocks.permissions).not.toContainEqual(['fleet.assignments', 'view']);
  });

  it.each([
    [{ ...valid, workDate: '2026-02-30' }, 'workDate'],
    [{ ...valid, asOf: '2026-08-14' }, 'asOf'],
    [{ ...valid, asOf: '2026-08-14T25:00:00Z' }, 'asOf'],
    [{ ...valid, projectId: 'not-a-uuid' }, 'projectId'],
    [{ ...valid, page: '0' }, 'page'],
    [{ ...valid, limit: '101' }, 'limit'],
  ])('rejects invalid overview query %o before delegation', async (query, _field) => {
    const result = await call(overviewHandler, 'GET', query); expect(result.status).toBe(400);
    expect(mocks.roster).not.toHaveBeenCalled(); expect(mocks.overview).not.toHaveBeenCalled();
  });

  it('rejects repeated and malformed overlay UUID/boolean filters and unscoped geometry', async () => {
    expect((await call(overlayHandler, 'GET', { ...valid, staffId: ['one', 'two'] })).status).toBe(400);
    expect((await call(overlayHandler, 'GET', { ...valid, siteId: 'bad' })).status).toBe(400);
    expect((await call(overlayHandler, 'GET', { ...valid, includeGeometry: 'yes' })).status).toBe(400);
    expect((await call(overlayHandler, 'GET', { workDate: valid.workDate, asOf: valid.asOf,
      includeGeometry: 'true' })).status).toBe(400);
    expect(mocks.overlay).not.toHaveBeenCalled();
  });

  it('rejects geometry flags on the coordinate-free overview', async () => {
    const result = await call(overviewHandler, 'GET', { ...valid, includeGeometry: 'false' });
    expect(result.status).toBe(400); expect(mocks.roster).not.toHaveBeenCalled();
  });

  it('rejects repeated overview scalars and mutually exclusive status filters', async () => {
    for (const query of [
      { ...valid, page: ['1', '2'] }, { ...valid, limit: ['10', '20'] },
      { ...valid, status: ['late', 'wrong_site'] }, { ...valid, group: ['late', 'wrong_site'] },
      { ...valid, status: 'late', group: 'late' },
    ]) expect((await call(overviewHandler, 'GET', query)).status).toBe(400);
    expect(mocks.roster).not.toHaveBeenCalled(); expect(mocks.overview).not.toHaveBeenCalled();
  });

  it('derives project scope from the session and delegates complete status to the coordinate-free overview', async () => {
    const roster = { items: [{ staffId: STAFF, latitude: -26.1, longitude: 28.1 }], page: 1,
      limit: 100, total: 1, hasMore: false };
    mocks.roster.mockResolvedValue(roster);
    mocks.overview.mockReturnValue({ selectionState: 'attention_available', groups: [{ group: 'late', count: 1 }],
      attention: { items: [{ staffId: STAFF, status: 'late' }], page: 2, limit: 10, total: 11, hasMore: false },
      roster: { page: 1, limit: 100, total: 1, hasMore: false } });
    const result = await call(overviewHandler, 'GET', { ...valid, page: '2', limit: '10', status: 'late' });
    expect(result.status).toBe(200); expect(mocks.staff).toHaveBeenCalledWith(USER);
    expect(mocks.project).toHaveBeenCalledWith(USER, STAFF, 'manager', PROJECT);
    expect(mocks.roster).toHaveBeenCalledWith({ ...valid, page: 1, limit: 100 });
    expect(mocks.overview).toHaveBeenCalledWith(roster, { page: 2, limit: 10, attentionStatuses: ['late'] });
    expect(JSON.stringify(result.body)).not.toMatch(/latitude|longitude|coordinates|geometry/);
  });

  it('forbids cross-project overview access without presenting an empty all-clear', async () => {
    mocks.project.mockResolvedValue(false);
    const result = await call(overviewHandler, 'GET', valid); expect(result.status).toBe(403);
    expect(mocks.roster).not.toHaveBeenCalled(); expect(result.body).not.toMatchObject({ success: true });
  });

  it('passes a server-derived actor scope to the scoped coordinate overlay', async () => {
    mocks.overlay.mockResolvedValue({ badges: [], attendancePoints: [{ staffId: STAFF, latitude: -26.1,
      longitude: 28.1 }], unplottable: [], geometry: { kind: 'aoi' }, page: 1, limit: 25, total: 1,
      hasMore: false, workDate: valid.workDate, evaluatedAt: valid.asOf });
    const result = await call(overlayHandler, 'GET', { ...valid, staffId: STAFF, siteId: SITE,
      includeGeometry: 'true', page: '1', limit: '25' });
    expect(result.status).toBe(200);
    expect(mocks.overlay).toHaveBeenCalledWith({ ...valid, staffId: STAFF, siteId: SITE,
      includeGeometry: true, page: 1, limit: 25 }, { userId: USER, staffId: STAFF, role: 'manager' });
    expect(result.body).toMatchObject({ success: true, data: { attendancePoints: [{ latitude: -26.1 }] } });
  });

  it('returns database failures as 500 and never substitutes empty success', async () => {
    mocks.roster.mockRejectedValue(new Error('database down'));
    const overview = await call(overviewHandler, 'GET', valid); expect(overview.status).toBe(500);
    expect(overview.body).not.toMatchObject({ success: true });

    mocks.overlay.mockRejectedValue(new Error('database down'));
    const overlay = await call(overlayHandler, 'GET', valid); expect(overlay.status).toBe(500);
    expect(overlay.body).not.toMatchObject({ success: true });
  });
});
