import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissionAllowed: true,
  permissionCalls: [] as Array<[string, string]>,
  listProjectSites: vi.fn(),
  createProjectSite: vi.fn(),
  updateProjectSite: vi.fn(),
  canEditAssignmentProject: vi.fn(),
  canViewAssignmentProject: vi.fn(),
  resolveStaffIdForUser: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => unknown) => async (req: NextApiRequest, res: NextApiResponse) => {
    mocks.permissionCalls.push([key, action]);
    if (!mocks.permissionAllowed) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
    }
    return handler(req, res);
  },
}));

vi.mock('@/modules/fleet/assignments/projectSiteQueries', () => ({
  ProjectSiteValidationError: class ProjectSiteValidationError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  listProjectSites: mocks.listProjectSites,
  createProjectSite: mocks.createProjectSite,
  updateProjectSite: mocks.updateProjectSite,
}));
vi.mock('@/modules/fleet/assignments/projectScope', () => ({
  canEditAssignmentProject: mocks.canEditAssignmentProject,
  canViewAssignmentProject: mocks.canViewAssignmentProject,
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({
  resolveStaffIdForUser: mocks.resolveStaffIdForUser,
}));

import indexHandler from '../project-sites/index';
import siteHandler from '../project-sites/[siteId]';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SITE_ID = '44444444-4444-4444-8444-444444444444';
const AOI_ID = '55555555-5555-4555-8555-555555555555';

interface ResponseState {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

async function callRoute(
  handler: typeof indexHandler,
  request: Partial<NextApiRequest> & { method: string },
): Promise<ResponseState> {
  const state: ResponseState = { statusCode: 200, body: undefined, headers: {} };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return response;
    },
  } as unknown as NextApiResponse;
  const req = {
    query: {},
    body: {},
    headers: {},
    cookies: {},
    user: { id: USER_ID, role: 'manager' },
    ...request,
  } as unknown as NextApiRequest;
  await handler(req, response);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissionCalls.length = 0;
  mocks.permissionAllowed = true;
  mocks.canEditAssignmentProject.mockResolvedValue(true);
  mocks.canViewAssignmentProject.mockResolvedValue(true);
  mocks.resolveStaffIdForUser.mockResolvedValue(STAFF_ID);
  mocks.listProjectSites.mockResolvedValue([]);
  mocks.createProjectSite.mockResolvedValue({ id: SITE_ID, projectId: PROJECT_ID });
  mocks.updateProjectSite.mockResolvedValue({ id: SITE_ID, projectId: PROJECT_ID });
});

describe('project-sites collection API', () => {
  it('gates methods before permission or data access', async () => {
    const response = await callRoute(indexHandler, { method: 'DELETE' });

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('GET, POST');
    expect(mocks.permissionCalls).toEqual([]);
    expect(mocks.listProjectSites).not.toHaveBeenCalled();
  });

  it('requires fleet.assignments view permission for GET', async () => {
    mocks.permissionAllowed = false;
    const response = await callRoute(indexHandler, {
      method: 'GET',
      query: { projectId: PROJECT_ID },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.permissionCalls).toEqual([['fleet.assignments', 'view']]);
    expect(mocks.listProjectSites).not.toHaveBeenCalled();
  });

  it('lists sites only after validating the project UUID and inactive flag', async () => {
    await callRoute(indexHandler, {
      method: 'GET',
      query: { projectId: PROJECT_ID, includeInactive: 'true' },
    });

    expect(mocks.listProjectSites).toHaveBeenCalledWith(PROJECT_ID, true);

    const invalid = await callRoute(indexHandler, {
      method: 'GET',
      query: { projectId: 'not-a-uuid' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  // The module-level view grant is broad (manager and viewer both hold it), so
  // without a per-project check any grant holder could enumerate any active
  // project's site configuration. Every other read here already re-checks scope.
  it('refuses to list sites for a project outside the caller scope', async () => {
    mocks.canViewAssignmentProject.mockResolvedValue(false);

    const response = await callRoute(indexHandler, {
      method: 'GET',
      query: { projectId: PROJECT_ID },
    });

    expect(response.statusCode).toBe(403);
    // Positive pin on WHY nothing leaked: the scope check ran with this
    // caller and this project, and the listing was never reached.
    expect(mocks.canViewAssignmentProject).toHaveBeenCalledWith(
      USER_ID, STAFF_ID, 'manager', PROJECT_ID,
    );
    expect(mocks.listProjectSites).not.toHaveBeenCalled();
  });

  it('scopes the GET listing to the requested project for an in-scope caller', async () => {
    await callRoute(indexHandler, {
      method: 'GET',
      query: { projectId: PROJECT_ID },
    });

    expect(mocks.canViewAssignmentProject).toHaveBeenCalledWith(
      USER_ID, STAFF_ID, 'manager', PROJECT_ID,
    );
    expect(mocks.listProjectSites).toHaveBeenCalledWith(PROJECT_ID, false);
  });

  it('returns 400 for an invalid source combination before checking project scope', async () => {
    const response = await callRoute(indexHandler, {
      method: 'POST',
      body: { projectId: PROJECT_ID, projectAoiId: AOI_ID, authorizedLocationId: SITE_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.canEditAssignmentProject).not.toHaveBeenCalled();
    expect(mocks.createProjectSite).not.toHaveBeenCalled();
  });

  it('requires edit permission and own-project scope for POST', async () => {
    mocks.canEditAssignmentProject.mockResolvedValue(false);
    const response = await callRoute(indexHandler, {
      method: 'POST',
      body: { projectId: PROJECT_ID, projectAoiId: AOI_ID },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.permissionCalls).toEqual([['fleet.assignments', 'edit']]);
    expect(mocks.canEditAssignmentProject).toHaveBeenCalledWith(
      USER_ID,
      STAFF_ID,
      'manager',
      PROJECT_ID,
    );
    expect(mocks.createProjectSite).not.toHaveBeenCalled();
  });

  it('derives the create actor from the session and ignores body actor fields', async () => {
    const response = await callRoute(indexHandler, {
      method: 'POST',
      body: {
        projectId: PROJECT_ID,
        projectAoiId: AOI_ID,
        isDefault: true,
        actorUserId: 'attacker-supplied-id',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.createProjectSite).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      displayName: undefined,
      projectAoiId: AOI_ID,
      authorizedLocationId: null,
      isDefault: true,
    }, { userId: USER_ID });
  });

  it('maps database uniqueness conflicts to 409', async () => {
    mocks.createProjectSite.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const response = await callRoute(indexHandler, {
      method: 'POST',
      body: { projectId: PROJECT_ID, projectAoiId: AOI_ID },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('project-sites item API', () => {
  it('permits only PUT and validates the named siteId', async () => {
    const methodResponse = await callRoute(siteHandler, { method: 'GET', query: { siteId: SITE_ID } });
    expect(methodResponse.statusCode).toBe(405);
    expect(methodResponse.headers.Allow).toBe('PUT');

    const idResponse = await callRoute(siteHandler, {
      method: 'PUT',
      query: { siteId: 'bad-id' },
      body: { projectId: PROJECT_ID, isActive: false },
    });
    expect(idResponse.statusCode).toBe(400);
  });

  it('enforces the body project scope and passes only the session actor to the update', async () => {
    await callRoute(siteHandler, {
      method: 'PUT',
      query: { siteId: SITE_ID },
      body: {
        projectId: PROJECT_ID,
        displayName: 'Renamed depot',
        isDefault: false,
        actorUserId: 'attacker-supplied-id',
      },
    });

    expect(mocks.permissionCalls).toEqual([['fleet.assignments', 'edit']]);
    expect(mocks.canEditAssignmentProject).toHaveBeenCalledWith(USER_ID, STAFF_ID, 'manager', PROJECT_ID);
    expect(mocks.updateProjectSite).toHaveBeenCalledWith(SITE_ID, {
      projectId: PROJECT_ID,
      displayName: 'Renamed depot',
      isDefault: false,
      isActive: undefined,
    }, { userId: USER_ID });
  });

  it('returns 404 when the scoped site does not exist', async () => {
    mocks.updateProjectSite.mockResolvedValue(null);
    const response = await callRoute(siteHandler, {
      method: 'PUT',
      query: { siteId: SITE_ID },
      body: { projectId: PROJECT_ID, isActive: false },
    });

    expect(response.statusCode).toBe(404);
  });
});
