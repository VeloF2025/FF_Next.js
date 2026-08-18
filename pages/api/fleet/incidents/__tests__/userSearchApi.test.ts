/**
 * RBAC + behavior tests for the scoped user-search/name-resolution endpoint
 * (`pages/api/fleet/incidents/settings/user-search.ts`).
 *
 * This route exists to fix a permission-scope defect: the incident settings
 * UI is authorized on `fleet.incidents-settings:edit`, and `reviewScope.ts`
 * explicitly supports a NON-admin user holding that permission via an
 * active override grant — but the UI used to call `/api/admin/users`,
 * gated `withRole('admin')`, so such a user got a 403 the moment they
 * searched for someone to add to oversight membership.
 *
 * Like `block-unblock.rbac.test.ts`, these tests exercise the REAL
 * `withPermission` middleware (only `withAuth` is stubbed to inject the
 * test user) so the "non-admin with the permission succeeds" and "caller
 * without the permission gets 403" claims are proven against actual
 * middleware behavior, not just a recorded gate key.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PERMISSION_KEY = 'fleet.incidents-settings';

const mocks = vi.hoisted(() => ({
  userHasPermission: vi.fn(),
  searchActiveUsers: vi.fn(),
  resolveActiveUserNames: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));
// Keep withPermission REAL; only stub withAuth so the test can inject req.user.
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, withAuth: (h: unknown) => h };
});
vi.mock('@/modules/fleet/incidents/settingsRepository', () => ({
  searchActiveUsers: mocks.searchActiveUsers,
  resolveActiveUserNames: mocks.resolveActiveUserNames,
}));

import handler from '../settings/user-search';

interface TestUser { id: string; role: string }

function invoke(method: string, query: Record<string, string>, user: TestUser | null) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = { method, query, user } as unknown as NextApiRequest;
  return { state, run: () => handler(req, res) };
}

const ADMIN: TestUser = { id: 'admin-1', role: 'admin' };
// A generic role that only holds fleet.incidents-settings:edit through an active
// per-user override grant (reviewScope.ts's supported non-admin case) — never
// through role membership. userHasPermission is what the real RBAC cascade
// (role_permissions -> user_permission_overrides) resolves; this test stubs it
// true to model exactly that grant without needing a real database.
const MANAGER: TestUser = { id: 'manager-1', role: 'manager' };
const TECHNICIAN: TestUser = { id: 'tech-1', role: 'technician' };
const SUPER_ADMIN: TestUser = { id: 'sa-1', role: 'super_admin' };

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/fleet/incidents/settings/user-search — permission gate', () => {
  it('denies a caller without fleet.incidents-settings:edit with 403 and never touches the repository', async () => {
    mocks.userHasPermission.mockResolvedValue(false);
    const { state, run } = invoke('GET', { search: 'nom' }, TECHNICIAN);

    await run();

    expect(state.status).toBe(403);
    expect((state.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    expect(mocks.userHasPermission).toHaveBeenCalledWith(TECHNICIAN.id, PERMISSION_KEY, 'edit');
    expect(mocks.searchActiveUsers).not.toHaveBeenCalled();
  });

  it('allows a NON-admin caller who holds fleet.incidents-settings:edit (e.g. via an active override grant)', async () => {
    mocks.userHasPermission.mockResolvedValue(true);
    mocks.searchActiveUsers.mockResolvedValue([{ id: 'u-1', name: 'Nomvula Khumalo' }]);
    const { state, run } = invoke('GET', { search: 'nom' }, MANAGER);

    await run();

    expect(state.status).toBe(200);
    expect(mocks.userHasPermission).toHaveBeenCalledWith(MANAGER.id, PERMISSION_KEY, 'edit');
    expect((state.body as { data: { users: unknown[] } }).data.users).toEqual([{ id: 'u-1', name: 'Nomvula Khumalo' }]);
  });

  it('bypasses the permission check for super_admin', async () => {
    mocks.searchActiveUsers.mockResolvedValue([]);
    const { state, run } = invoke('GET', { search: 'nom' }, SUPER_ADMIN);

    await run();

    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(state.status).toBe(200);
  });
});

describe('GET /api/fleet/incidents/settings/user-search — behavior', () => {
  beforeEach(() => { mocks.userHasPermission.mockResolvedValue(true); });

  it('allows GET only', async () => {
    const { state, run } = invoke('POST', {}, ADMIN);

    await run();

    expect(state.status).toBe(405);
    expect(state.headers.Allow).toBe('GET');
  });

  it('requires a search term or an ids list', async () => {
    const { state, run } = invoke('GET', {}, ADMIN);

    await run();

    expect(state.status).toBe(400);
    expect(mocks.searchActiveUsers).not.toHaveBeenCalled();
  });

  it('excludes inactive users from the response, even when they match the search term', async () => {
    // Models what the repository's `is_active = true` predicate enforces (asserted
    // directly against the SQL text in settingsRepository.test.ts): an inactive
    // fixture user must never surface in the handler's response.
    const fixture = [
      { id: 'active-1', name: 'Nomvula Khumalo', isActive: true },
      { id: 'inactive-1', name: 'Departed Person', isActive: false },
    ];
    mocks.searchActiveUsers.mockImplementation(async (term: string) => fixture
      .filter((candidate) => candidate.isActive && candidate.name.toLowerCase().includes(term.toLowerCase()))
      .map((candidate) => ({ id: candidate.id, name: candidate.name })));
    const { state, run } = invoke('GET', { search: 'Person' }, ADMIN);

    await run();

    expect(state.status).toBe(200);
    expect((state.body as { data: { users: unknown[] } }).data.users).toEqual([]);
  });

  it('never returns an email or credential field — only id and name', async () => {
    mocks.searchActiveUsers.mockResolvedValue([{ id: 'u-1', name: 'Nomvula Khumalo' }]);
    const { state, run } = invoke('GET', { search: 'nom' }, ADMIN);

    await run();

    const users = (state.body as { data: { users: Array<Record<string, unknown>> } }).data.users;
    expect(users).toHaveLength(1);
    expect(Object.keys(users[0])).toEqual(['id', 'name']);
    expect(JSON.stringify(state.body)).not.toMatch(/email|password|token|credential/i);
  });

  it('resolves names by ids when ids is provided instead of search', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    mocks.resolveActiveUserNames.mockResolvedValue([{ id: userId, name: 'Nomvula Khumalo' }]);
    const { state, run } = invoke('GET', { ids: userId }, ADMIN);

    await run();

    expect(mocks.resolveActiveUserNames).toHaveBeenCalledWith([userId]);
    expect(state.status).toBe(200);
    expect(mocks.searchActiveUsers).not.toHaveBeenCalled();
  });

  it('rejects a malformed ids entry with 400 before calling the repository', async () => {
    const { state, run } = invoke('GET', { ids: 'not-a-uuid' }, ADMIN);

    await run();

    expect(state.status).toBe(400);
    expect(mocks.resolveActiveUserNames).not.toHaveBeenCalled();
    expect(mocks.searchActiveUsers).not.toHaveBeenCalled();
  });

  it('maps a repository failure to 500 without leaking it as success', async () => {
    mocks.searchActiveUsers.mockRejectedValue(new Error('db exploded'));
    const { state, run } = invoke('GET', { search: 'nom' }, ADMIN);

    await run();

    expect(state.status).toBe(500);
    expect(state.body).not.toMatchObject({ success: true });
  });
});
