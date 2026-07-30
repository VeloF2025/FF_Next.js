import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ErrorCode } from '@/lib/apiResponse';
import { ProjectStatsError } from '@/modules/qfield-sync/project-stats/errors';

const { getProjectStats, sqlMock, userHasPermission, verifyToken } = vi.hoisted(() => ({
  getProjectStats: vi.fn(),
  sqlMock: vi.fn(),
  userHasPermission: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock('@/modules/qfield-sync/project-stats/projectStatsService', () => ({
  getProjectStats,
}));

vi.mock('@/lib/db-neon', () => ({ neon: () => sqlMock }));
vi.mock('@/lib/auth/jwt', () => ({ verifyToken }));
vi.mock('@/lib/auth/sessionUsage', () => ({ touchSessionUsage: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ userHasPermission }));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import projectStatsApi, { projectStatsHandler } from '@/pages/api/qfield/project-stats';

function request(
  method = 'GET',
  query: Record<string, string> = { project: 'Mahikeng' }
) {
  const mocks = createMocks<NextApiRequest, NextApiResponse>({ method, query });
  Object.assign(mocks.req, {
    user: {
      id: 'u1',
      email: 'user@example.com',
      role: 'admin',
      permissions: ['projects.view'],
    },
  });
  return mocks;
}

function responseBody(res: NextApiResponse): Record<string, unknown> {
  return JSON.parse((res as NextApiResponse & { _getData(): string })._getData());
}

function authenticatedRequest() {
  return createMocks<NextApiRequest, NextApiResponse>({
    method: 'GET',
    query: { project: 'Mahikeng' },
    headers: { authorization: 'Bearer token' },
  });
}

function sessionRow() {
  return [{
    id: 'u1',
    email: 'user@example.com',
    first_name: 'User',
    last_name: 'Example',
    role: 'viewer',
    permissions: [],
    is_active: true,
    profile_picture: null,
    department: null,
    session_id: 's1',
    is_impersonation: false,
    kind: 'browser',
  }];
}

function expectRequestId(res: NextApiResponse) {
  const body = responseBody(res);
  expect(res.getHeader('X-Request-Id')).toEqual(expect.any(String));
  expect(body).toMatchObject({ meta: { requestId: res.getHeader('X-Request-Id') } });
}

describe('GET /api/qfield/project-stats', () => {
  beforeEach(() => {
    getProjectStats.mockReset();
    sqlMock.mockReset();
    userHasPermission.mockReset();
    verifyToken.mockReset();
    verifyToken.mockResolvedValue({
      sub: 'u1', sessionId: 's1', email: 'user@example.com', role: 'viewer', permissions: [],
    });
  });

  it('returns the standard success envelope with the authenticated user and request ID', async () => {
    getProjectStats.mockResolvedValue({ status: 'complete', generatedAt: 'now' });
    const { req, res } = request();

    await projectStatsHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(responseBody(res)).toMatchObject({
      success: true,
      data: { status: 'complete' },
      meta: { requestId: expect.any(String) },
    });
    expect(res.getHeader('X-Request-Id')).toEqual(expect.any(String));
    expect(getProjectStats).toHaveBeenCalledWith(
      { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
      expect.objectContaining({ userId: 'u1', userEmail: 'user@example.com' })
    );
  });

  it('rejects non-GET methods without calling the service', async () => {
    const { req, res } = request('POST');

    await projectStatsHandler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(responseBody(res)).toMatchObject({
      success: false,
      error: { code: ErrorCode.METHOD_NOT_ALLOWED },
    });
    expect(getProjectStats).not.toHaveBeenCalled();
  });

  it('maps invalid real query input to BAD_REQUEST without exposing a stack trace', async () => {
    const { req, res } = request('GET', { project: '' });

    await projectStatsHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(responseBody(res)).toMatchObject({
      success: false,
      error: { code: ErrorCode.BAD_REQUEST },
      meta: { requestId: expect.any(String) },
    });
    expect(res._getData()).not.toContain('stack');
  });

  it('rejects an unsafe page integer before calling the service', async () => {
    const { req, res } = request('GET', {
      project: 'Mahikeng',
      page: '9007199254740992',
    });

    await projectStatsHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(responseBody(res)).toMatchObject({
      success: false,
      error: {
        code: ErrorCode.BAD_REQUEST,
        message: 'page must be a positive integer',
      },
    });
    expect(getProjectStats).not.toHaveBeenCalled();
  });

  it.each([
    [ErrorCode.NOT_FOUND, 404, undefined],
    [ErrorCode.CONFLICT, 409, { candidates: [{ id: 'project-1', name: 'Mahikeng' }] }],
    [ErrorCode.VALIDATION_ERROR, 422, { reason: 'No active QField link' }],
    [ErrorCode.SERVICE_UNAVAILABLE, 503, undefined],
  ])('maps %s to HTTP %i with only safe domain details', async (code, status, details) => {
    getProjectStats.mockRejectedValueOnce(
      new ProjectStatsError(code, 'Safe domain message', details)
    );
    const { req, res } = request();

    await projectStatsHandler(req, res);

    expect(res._getStatusCode()).toBe(status);
    expect(responseBody(res)).toMatchObject({
      success: false,
      error: { code, message: 'Safe domain message', ...(details ? { details } : {}) },
      meta: { requestId: expect.any(String) },
    });
  });

  it('returns a generic 500 for unexpected errors without exposing error details', async () => {
    getProjectStats.mockRejectedValueOnce(new Error('database password leaked'));
    const { req, res } = request();

    await projectStatsHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(responseBody(res)).toMatchObject({
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'QField project statistics request failed',
      },
      meta: { requestId: expect.any(String) },
    });
    expect(res._getData()).not.toContain('database password leaked');
    expect(res._getData()).not.toContain('stack');
  });

  it('adds a request ID to an unauthenticated default-export rejection', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET', query: { project: 'Mahikeng' },
    });

    await projectStatsApi(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(responseBody(res)).toMatchObject({ error: { code: ErrorCode.UNAUTHORIZED } });
    expectRequestId(res);
    expect(getProjectStats).not.toHaveBeenCalled();
  });

  it('adds a request ID when the real permission wrapper denies projects:view', async () => {
    sqlMock.mockResolvedValueOnce(sessionRow());
    userHasPermission.mockResolvedValueOnce(false);
    const { req, res } = authenticatedRequest();

    await projectStatsApi(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(responseBody(res)).toMatchObject({ error: { code: ErrorCode.FORBIDDEN } });
    expectRequestId(res);
    expect(userHasPermission).toHaveBeenCalledWith('u1', 'projects', 'view');
    expect(getProjectStats).not.toHaveBeenCalled();
  });

  it('adds a request ID when the real permission check fails closed', async () => {
    sqlMock.mockResolvedValueOnce(sessionRow());
    userHasPermission.mockRejectedValueOnce(new Error('permission database unavailable'));
    const { req, res } = authenticatedRequest();

    await projectStatsApi(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(responseBody(res)).toMatchObject({ error: { code: 'PERMISSION_CHECK_ERROR' } });
    expectRequestId(res);
    expect(getProjectStats).not.toHaveBeenCalled();
  });

  it('runs the real auth and permission composition before reaching the service', async () => {
    sqlMock.mockResolvedValueOnce(sessionRow());
    userHasPermission.mockResolvedValueOnce(true);
    getProjectStats.mockResolvedValueOnce({ status: 'complete', generatedAt: 'now' });
    const { req, res } = authenticatedRequest();

    await projectStatsApi(req, res);

    expect(res._getStatusCode()).toBe(200);
    expectRequestId(res);
    expect(getProjectStats).toHaveBeenCalledWith(
      { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
      expect.objectContaining({
        userId: 'u1',
        userEmail: 'user@example.com',
        requestId: res.getHeader('X-Request-Id'),
      })
    );
  });
});
