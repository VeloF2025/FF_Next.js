/**
 * Regression guard for issue #2284: revoking a session must lock these routes.
 *
 * All 13 `app/api/analytics/reports/*` handlers used to authenticate on the JWT
 * signature alone — `verifyToken(token)` and nothing else. They never looked up
 * `user_sessions`, so deleting a session row (which is exactly what revoking an MCP
 * token does) had no effect: the credential kept working until the JWT expired on its
 * own, and `mintFfMcpToken` signs those for the token's full lifetime — up to a year.
 * `userHasPermission` queries `users` with no `is_active` filter, so deactivating a
 * user did not close them either.
 *
 * The assertion that matters is negative: a request whose session row is gone must be
 * refused, and the SharePoint data layer must never be reached. The JWT is deliberately
 * mocked VALID and RBAC mocked ALLOW throughout, so nothing but the session lookup can
 * be responsible for the 401 — pre-fix, every one of these returned data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { queryMock, verifyTokenMock, hasPermissionMock, getWorksheetRangeMock } = vi.hoisted(
  () => ({
    queryMock: vi.fn(),
    verifyTokenMock: vi.fn(),
    hasPermissionMock: vi.fn(),
    getWorksheetRangeMock: vi.fn(),
  })
);

// `@/lib/db` is imported two ways across these routes: app-router.ts takes the named
// `pool`, three of the report routes default-import it. Both must be stubbed or the
// unmocked one issues a real query.
vi.mock('@/lib/db', () => ({
  pool: { query: queryMock },
  default: { query: queryMock },
}));
vi.mock('@/lib/auth/jwt', () => ({ verifyToken: verifyTokenMock }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: hasPermissionMock }));
vi.mock('@/lib/auth/sessionUsage', () => ({ touchSessionUsage: vi.fn() }));
vi.mock('@/lib/graph/sharepoint-excel', () => ({ getWorksheetRange: getWorksheetRangeMock }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ROUTES = [
  'activations',
  'assets-register',
  'build-milestones',
  'cos-breakdown',
  'expense-pivot',
  'income-statement',
  'opex',
  'pre-provisions',
  'project-detail',
  'project-fin',
  'project-revenue',
  'revenue-by-client',
  'revenue-overview',
] as const;

const USER_ID = 'user-1';

function req(): NextRequest {
  const r = new NextRequest('http://localhost/api/analytics/reports/x?project=P1');
  r.cookies.set('ff_auth_token', 'header.payload.signature');
  return r;
}

function sessionRow() {
  return {
    id: USER_ID,
    email: 'a@x.co',
    first_name: 'A',
    last_name: 'B',
    role: 'admin',
    permissions: ['*'],
    is_active: true,
    profile_picture: null,
    department: null,
    kind: 'browser',
  };
}

describe('analytics/reports routes reject a revoked session (#2284)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // JWT is cryptographically fine — this is the revoked-but-unexpired state.
    verifyTokenMock.mockResolvedValue({ sub: USER_ID, sessionId: 'sess-1' });
    // RBAC would allow it, so RBAC cannot be what refuses the request.
    hasPermissionMock.mockResolvedValue(true);
    // No matching user_sessions row: revoked, expired, or the user deactivated.
    queryMock.mockResolvedValue({ rows: [] });
    getWorksheetRangeMock.mockResolvedValue({ values: [] });
  });

  it.each(ROUTES)('GET /api/analytics/reports/%s returns 401', async (name) => {
    const { GET } = await import(`@/app/api/analytics/reports/${name}/route`);
    const res = await GET(req());

    expect(res.status).toBe(401);
    // The report data must never be fetched for an unauthenticated caller.
    expect(getWorksheetRangeMock).not.toHaveBeenCalled();
  });

  /**
   * Positive control. Without this, a 401 caused by anything else — a broken import, a
   * mock that fails to resolve — would look identical to the guard working, and the
   * suite above would pass while pinning nothing.
   */
  it('lets a live session through to the data layer', async () => {
    queryMock.mockResolvedValue({ rows: [sessionRow()] });

    const { GET } = await import('@/app/api/analytics/reports/income-statement/route');
    const res = await GET(req());

    expect(res.status).not.toBe(401);
    expect(getWorksheetRangeMock).toHaveBeenCalled();
  });
});
