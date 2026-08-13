import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ roster: vi.fn(), detail: vi.fn(), project: vi.fn(), oversight: vi.fn(), staff: vi.fn(), permissions: [] as Array<[string, string]> }));
vi.mock('@/lib/auth/middleware', () => ({ withAuth: (handler: unknown) => handler, withPermission: (key: string, action: string) => (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => { mocks.permissions.push([key, action]); return handler; } }));
vi.mock('@/modules/fleet/operations/statusService', async () => { const actual = await vi.importActual<typeof import('@/modules/fleet/operations/statusService')>('@/modules/fleet/operations/statusService'); return { ...actual, getOperationalRosterStatus: mocks.roster, getOperationalEvidenceDetail: mocks.detail }; });
vi.mock('@/modules/fleet/operations/projectScope', () => ({ canAccessOperationalProject: mocks.project, hasOperationalOversight: mocks.oversight }));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
import rosterHandler from '../status';
import detailHandler from '../status/[staffId]';
import { OperationalStatusRequestError } from '@/modules/fleet/operations/statusService';

const USER = '11111111-1111-4111-8111-111111111111'; const STAFF = '22222222-2222-4222-8222-222222222222'; const PROJECT = '33333333-3333-4333-8333-333333333333';
async function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, query: Record<string, string>) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = { status(code: number) { state.status = code; return res; }, json(body: unknown) { state.body = body; return res; }, setHeader(name: string, value: string) { state.headers[name] = value; return res; } } as unknown as NextApiResponse;
  await handler({ method, query, user: { id: USER, role: 'manager' } } as unknown as NextApiRequest, res); return state;
}
beforeEach(() => { vi.clearAllMocks(); mocks.permissions.length = 0; mocks.staff.mockResolvedValue(STAFF); mocks.project.mockResolvedValue(true); mocks.oversight.mockResolvedValue(false); mocks.roster.mockResolvedValue({ items: [], page: 1, limit: 25 }); mocks.detail.mockResolvedValue({ staffId: STAFF, workDate: '2026-08-13', evaluation: {}, points: [] }); });

describe('operational status APIs', () => {
  it('allows GET only and rejects malformed query values before loading', async () => {
    const denied = await call(rosterHandler, 'POST', {}); expect(denied.status).toBe(405); expect(denied.headers.Allow).toBe('GET');
    const detailDenied = await call(detailHandler, 'POST', {}); expect(detailDenied.status).toBe(405); expect(detailDenied.headers.Allow).toBe('GET');
    const invalid = await call(rosterHandler, 'GET', { projectId: 'bad-id', workDate: 'bad', asOf: 'bad', page: 'x' });
    expect(invalid.status).toBe(400); expect(mocks.roster).not.toHaveBeenCalled();
  });

  it('maps strict service input failures to bad requests', async () => {
    mocks.roster.mockRejectedValue(new OperationalStatusRequestError('workDate must be a valid ISO date'));
    const result = await call(rosterHandler, 'GET', { projectId: PROJECT, workDate: '2026-02-30', asOf: '2026-08-13T08:00:00.000Z', page: '0', limit: '101' });
    expect(result.status).toBe(400); expect(result.body).toMatchObject({ success: false });
  });

  it('enforces project scope and propagates loader failures as errors', async () => {
    const query = { projectId: PROJECT, workDate: '2026-08-13', asOf: '2026-08-13T08:00:00.000Z' };
    mocks.project.mockResolvedValue(false); expect((await call(rosterHandler, 'GET', query)).status).toBe(403);
    mocks.project.mockResolvedValue(true); mocks.roster.mockRejectedValue(new Error('database down'));
    const failed = await call(rosterHandler, 'GET', query); expect(failed.status).toBe(500); expect(failed.body).not.toMatchObject({ success: true });
  });

  it('uses project scope for detail and returns coordinate-free roster summaries', async () => {
    const query = { projectId: PROJECT, staffId: STAFF, workDate: '2026-08-13', asOf: '2026-08-13T08:00:00.000Z' };
    mocks.roster.mockResolvedValue({ items: [{ staffId: STAFF, status: 'attendance_confirmed', projectName: 'Project One', operationalSiteName: 'Site One', monitoringStart: '2026-08-13T05:00:00.000Z', monitoringEnd: '2026-08-13T16:00:00.000Z', gpsStaleAfterSeconds: 7200 }], page: 1, limit: 25, total: 26, hasMore: true });
    const roster = await call(rosterHandler, 'GET', query); expect(JSON.stringify(roster.body)).not.toContain('latitude');
    expect(roster.body).toMatchObject({ data: { total: 26, hasMore: true, items: [expect.objectContaining({ projectName: 'Project One', operationalSiteName: 'Site One', monitoringStart: '2026-08-13T05:00:00.000Z', monitoringEnd: '2026-08-13T16:00:00.000Z', gpsStaleAfterSeconds: 7200 })] } });
    await call(detailHandler, 'GET', query);
    expect(mocks.project).toHaveBeenCalledWith(USER, STAFF, 'manager', PROJECT);
    expect(mocks.detail).toHaveBeenCalledWith({ staffId: STAFF, projectId: PROJECT, workDate: query.workDate, asOf: query.asOf });
  });

  it('permits no-project detail only with oversight and returns minimum points', async () => {
    const query = { staffId: STAFF, workDate: '2026-08-13', asOf: '2026-08-13T08:00:00.000Z' };
    expect((await call(detailHandler, 'GET', query)).status).toBe(403);
    mocks.oversight.mockResolvedValue(true); mocks.detail.mockResolvedValue({ staffId: STAFF, points: [{ source: 'vehicle_latest', latitude: -26, longitude: 28, recordedAt: query.asOf }] });
    const allowed = await call(detailHandler, 'GET', query); expect(allowed.status).toBe(200);
    expect(mocks.detail).toHaveBeenCalledWith({ staffId: STAFF, projectId: undefined, workDate: query.workDate, asOf: query.asOf });
    expect(allowed.body).toMatchObject({ data: { points: [{ source: 'vehicle_latest' }] } });
  });

  it('does not convert a detail database failure into empty evidence', async () => {
    const query = { staffId: STAFF, workDate: '2026-08-13', asOf: '2026-08-13T08:00:00.000Z' };
    mocks.oversight.mockResolvedValue(true); mocks.detail.mockRejectedValue(new Error('database down'));
    const failed = await call(detailHandler, 'GET', query); expect(failed.status).toBe(500);
    expect(failed.body).not.toMatchObject({ success: true });
  });
});
