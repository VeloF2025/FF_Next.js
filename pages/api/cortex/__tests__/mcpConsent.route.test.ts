/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@neondatabase/serverless');
vi.unmock('@/lib/db-neon');
vi.unmock('@/lib/db');
vi.unmock('@/lib/auth');
vi.unmock('@/lib/permissions');
vi.unmock('@/lib/logger');
vi.unmock('@/lib/apiResponse');

import {
  startRealConsentRoute,
  type ConsentRouteDatabase,
  type RouteResponse,
} from './mcpConsent.routeTestHarness';

let route: Awaited<ReturnType<typeof startRealConsentRoute>>;
let database: ConsentRouteDatabase;
const originalUiFlag = process.env.CORTEX_MCP_TOKEN_UI_ENABLED;

beforeAll(async () => {
  // The route's outermost gate 404s the endpoint when this is off, so the
  // auth/RBAC assertions below need it on to reach the layers they test.
  process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'true';
  route = await startRealConsentRoute();
  database = route.database;
});

beforeEach(() => {
  database.clear();
  route.callback.count = 0;
  route.callback.stateId = undefined;
  route.callback.hasJwt = undefined;
  route.callback.authenticatedSecret = undefined;
});

afterAll(async () => {
  if (route) await route.close();
  process.env.CORTEX_MCP_TOKEN_UI_ENABLED = originalUiFlag;
});

function expectError(response: RouteResponse, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.json).toMatchObject({
    success: false,
    error: { code },
  });
}

describe('default Cortex consent route — real auth and permission middleware', () => {
  /**
   * The sibling mint/revoke route (pages/api/cortex/mcp-token.ts) treats this
   * flag as its outermost gate. Consent mints the same bearer, so it must hide
   * behind the same switch — otherwise the kill switch does not kill anything.
   */
  it('hides the endpoint entirely when the Cortex UI flag is off', async () => {
    process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'false';
    try {
      const authenticated = await route.request('POST', true, {
        stateId: 'abcdefghijklmnopqrstuvwx',
      });
      expectError(authenticated, 404, 'NOT_FOUND');

      // Gate is outermost: no session lookup, no RBAC query, no token minted.
      expect(database.queries).toEqual([]);
      expect(route.callback.count).toBe(0);
    } finally {
      process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'true';
    }
  });

  it('returns the real withAuth 401 before method or database access', async () => {
    const response = await route.request('GET', false);

    expectError(response, 401, 'UNAUTHORIZED');
    expect(database.queries).toEqual([]);
    expect(route.callback.count).toBe(0);
  });

  it('authenticates before rejecting GET and never performs an RBAC query', async () => {
    const response = await route.request('GET', true);

    expectError(response, 405, 'METHOD_NOT_ALLOWED');
    expect(response.headers.get('allow')).toBe('POST');
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]?.text).toContain('INNER JOIN user_sessions');
    expect(database.queries.some(({ text }) =>
      text.includes('SELECT role, permissions FROM users WHERE id'))).toBe(false);
    expect(route.callback.count).toBe(0);
  });

  it('denies an authenticated non-superadmin through real cortex.review:view RBAC', async () => {
    const response = await route.request('POST', true);

    expectError(response, 403, 'FORBIDDEN');
    expect(response.json.error?.message).toBe(
      'Missing required permission: cortex.review',
    );
    expect(database.queries[0]?.text).toContain('INNER JOIN user_sessions');
    expect(database.queries.some(({ text, params }) =>
      text.includes('SELECT role, permissions FROM users WHERE id')
      && params[0] === 'route-user')).toBe(true);
    expect(database.queries.some(({ text, params }) =>
      text.includes('FROM role_permissions')
      && params.includes('cortex.review')
      && params.includes('admin'))).toBe(true);
    expect(route.callback.count).toBe(0);
  });

  it('fails closed when the real permission query fails', async () => {
    database.permissionResult = 'error';

    const response = await route.request('POST', true);

    expectError(response, 500, 'PERMISSION_CHECK_ERROR');
    expect(response.json.error?.message).toBe('Permission check failed');
    expect(database.queries.some(({ text }) =>
      text.includes('SELECT role, permissions FROM users WHERE id'))).toBe(true);
    expect(route.callback.count).toBe(0);
  });

  it('grants real RBAC and reaches the loopback callback with a minted JWT', async () => {
    database.permissionResult = 'allow';

    const response = await route.request('POST', true);

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      success: true,
      data: {
        redirectUrl: 'https://claude.ai/mcp/callback?code=route-test',
      },
    });
    expect(route.callback).toMatchObject({
      count: 1,
      stateId: 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g',
      hasJwt: true,
      authenticatedSecret: true,
    });
  });
});
