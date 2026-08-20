import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(), commit: vi.fn(), copy: vi.fn(), replace: vi.fn(), end: vi.fn(), history: vi.fn(),
  loadProject: vi.fn(), loadCopy: vi.fn(), editScope: vi.fn(), viewScope: vi.fn(), staff: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: () => (handler: unknown) => handler,
}));
vi.mock('@/modules/fleet/assignments/bulkAssignmentService', () => ({
  AssignmentServiceError: class AssignmentServiceError extends Error {
    constructor(public code: string, message: string, public status: number) { super(message); }
  },
  previewAssignments: mocks.preview, commitAssignments: mocks.commit,
  previewAssignmentCopy: mocks.copy, replaceAssignment: mocks.replace,
  endAssignment: mocks.end, getAssignmentHistory: mocks.history,
}));
vi.mock('@/modules/fleet/assignments/assignmentQueries', () => ({
  loadAssignmentProjectId: mocks.loadProject, loadAssignmentsForCopy: mocks.loadCopy,
}));
vi.mock('@/modules/fleet/assignments/projectScope', () => ({
  canEditAssignmentProject: mocks.editScope, canViewAssignmentProject: mocks.viewScope,
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));

import previewHandler from '@/pages/api/fleet/assignments/preview';
import commitHandler from '@/pages/api/fleet/assignments/commit';
import copyHandler from '@/pages/api/fleet/assignments/copy-preview';
import assignmentHandler from '@/pages/api/fleet/assignments/[assignmentId]';
import historyHandler from '@/pages/api/fleet/assignments/[assignmentId]/history';
import { AssignmentServiceError } from '@/modules/fleet/assignments/bulkAssignmentService';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const ASSIGNMENT = '44444444-4444-4444-8444-444444444444';

async function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, body: unknown = {}, query: Record<string, string> = {}) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = { status(code: number) { state.status = code; return res; }, json(value: unknown) { state.body = value; return res; }, setHeader(name: string, value: string) { state.headers[name] = value; return res; } } as unknown as NextApiResponse;
  await handler({ method, body, query, user: { id: USER, role: 'manager' } } as unknown as NextApiRequest, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.staff.mockResolvedValue(STAFF); mocks.editScope.mockResolvedValue(true);
  mocks.viewScope.mockResolvedValue(true); mocks.loadProject.mockResolvedValue(PROJECT);
  mocks.loadCopy.mockResolvedValue([{ projectId: PROJECT }]); mocks.preview.mockResolvedValue({});
  mocks.commit.mockResolvedValue({ batchId: 'batch', assignmentIds: [] }); mocks.copy.mockResolvedValue({});
  mocks.history.mockResolvedValue([]);
});

describe('assignment write APIs', () => {
  it('rejects unsupported methods and actions', async () => {
    expect((await call(previewHandler, 'GET')).status).toBe(405);
    expect((await call(assignmentHandler, 'PUT', { action: 'delete' }, { assignmentId: ASSIGNMENT })).status).toBe(400);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('maps missing preview and copy resources to 404', async () => {
    mocks.preview.mockRejectedValueOnce(new AssignmentServiceError('ASSIGNMENT_NOT_FOUND', 'missing', 404));
    expect((await call(previewHandler, 'POST', { rows: [] })).status).toBe(404);
    mocks.copy.mockRejectedValueOnce(new AssignmentServiceError('ASSIGNMENT_NOT_FOUND', 'missing', 404));
    expect((await call(copyHandler, 'POST', { assignmentIds: [ASSIGNMENT], destinationStartDate: '2026-08-12' })).status).toBe(404);
  });

  it('derives the commit actor and project scope from the session', async () => {
    const row = { projectId: PROJECT };
    expect((await call(commitHandler, 'POST', { rows: [row], fingerprint: 'hash' })).status).toBe(200);
    expect(mocks.editScope).toHaveBeenCalledWith(USER, STAFF, 'manager', PROJECT);
    expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({ rows: [row] }), 'hash', { userId: USER, staffId: STAFF, role: 'manager' });
  });

  it('checks source-project scope before copying', async () => {
    mocks.editScope.mockResolvedValue(false);
    expect((await call(copyHandler, 'POST', { assignmentIds: [ASSIGNMENT], destinationStartDate: '2026-08-12' })).status).toBe(403);
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it('uses view scope for history without leaking inaccessible data', async () => {
    mocks.viewScope.mockResolvedValue(false);
    expect((await call(historyHandler, 'GET', {}, { assignmentId: ASSIGNMENT })).status).toBe(403);
    expect(mocks.viewScope).toHaveBeenCalledWith(USER, STAFF, 'manager', PROJECT);
    expect(mocks.history).not.toHaveBeenCalled();
  });
});
