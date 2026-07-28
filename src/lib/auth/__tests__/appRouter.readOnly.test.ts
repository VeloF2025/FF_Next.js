/**
 * Read-only MCP gate wiring for the APP ROUTER wrappers.
 *
 * `middleware.readOnly.test.ts` pins the three Pages Router wrappers. This file pins the
 * App Router side, which had no test file at all.
 *
 * That gap mattered: this whole gate exists because `withFleetAuth` once shipped without
 * it, leaving 11 mutating fleet routes writable with a read-only token. Leaving the other
 * canonical wrapper uncovered invites the identical failure — and `requireAuth` is named
 * in the plan as an enforcement point, so a future edit could silently drop the check
 * with nothing to catch it.
 *
 * `requirePermission` is included deliberately: it composes on top of `requireAuth`, so
 * it must inherit the gate. If someone later reimplements it independently, this fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { queryMock, verifyTokenMock, hasPermissionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  verifyTokenMock: vi.fn(),
  hasPermissionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ pool: { query: queryMock } }));
vi.mock('../jwt', () => ({ verifyToken: verifyTokenMock }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: hasPermissionMock }));
vi.mock('../sessionUsage', () => ({ touchSessionUsage: vi.fn() }));

import { getUserFromRequest, requireAuth, requirePermission } from '../app-router';

const TOKEN = 'header.payload.signature';

function userRow(kind: string) {
  return {
    id: 'u1',
    email: 'a@x.co',
    role: 'viewer',
    permissions: [],
    is_active: true,
    session_id: 's1',
    kind,
  };
}

function req(method: string): NextRequest {
  return new NextRequest('https://app.fibreflow.app/api/anything', {
    method,
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

/** Session of the given kind resolves successfully. */
function givenSession(kind: string) {
  verifyTokenMock.mockResolvedValue({ sub: 'u1', sessionId: 's1', email: 'a@x.co', role: 'viewer' });
  queryMock.mockResolvedValue({ rows: [userRow(kind)] });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockResolvedValue(true);
});

describe('requireAuth — read-only gate', () => {
  const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

  it.each(MUTATING)('refuses %s from an mcp session with 403 MCP_READ_ONLY', async (method) => {
    givenSession('mcp');

    const [user, denial] = await requireAuth(req(method));

    expect(user).toBeNull();
    expect(denial?.status).toBe(403);
    expect((await denial!.json()).error.code).toBe('MCP_READ_ONLY');
  });

  it.each(['GET', 'HEAD'] as const)('allows %s from an mcp session', async (method) => {
    givenSession('mcp');

    const [user, denial] = await requireAuth(req(method));

    expect(denial).toBeNull();
    expect(user?.id).toBe('u1');
  });

  it.each(MUTATING)('allows %s from a browser session', async (method) => {
    givenSession('browser');

    const [user, denial] = await requireAuth(req(method));

    expect(denial).toBeNull();
    expect(user?.id).toBe('u1');
  });

  it('401s an unauthenticated request without consulting the gate', async () => {
    verifyTokenMock.mockResolvedValue(null);

    const [user, denial] = await requireAuth(req('POST'));

    expect(user).toBeNull();
    expect(denial?.status).toBe(401);
  });
});

describe('requirePermission — inherits the gate from requireAuth', () => {
  it('refuses a mutating mcp request BEFORE checking permissions', async () => {
    // Ordering matters: a read-only credential must be refused on the method, not on
    // whether the user happens to hold the permission. Otherwise an mcp session belonging
    // to a privileged user would sail through.
    givenSession('mcp');

    const [user, denial] = await requirePermission(req('DELETE'), 'projects', 'delete');

    expect(user).toBeNull();
    expect(denial?.status).toBe(403);
    expect((await denial!.json()).error.code).toBe('MCP_READ_ONLY');
    expect(hasPermissionMock, 'permission was consulted before the gate refused').not.toHaveBeenCalled();
  });

  it('still allows a permitted mutating request from a browser session', async () => {
    givenSession('browser');

    const [user, denial] = await requirePermission(req('DELETE'), 'projects', 'delete');

    expect(denial).toBeNull();
    expect(user?.id).toBe('u1');
    expect(hasPermissionMock).toHaveBeenCalledOnce();
  });
});

describe('getUserFromRequest — resolves kind from the session row', () => {
  it('carries sessionKind through so the gate can see it', async () => {
    givenSession('mcp');

    const user = await getUserFromRequest(req('GET'));

    // If this ever comes back undefined the gate silently passes everything:
    // isReadOnlyViolation returns false when sessionKind !== 'mcp'.
    expect(user?.sessionKind).toBe('mcp');
  });
});
