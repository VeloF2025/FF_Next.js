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
  process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'true';
  route = await startRealConsentRoute('context');
  database = route.database;
});

beforeEach(() => {
  database.clear();
  route.callback.count = 0;
  route.callback.path = undefined;
  route.callback.stateId = undefined;
  route.callback.authenticatedSecret = undefined;
});

afterAll(async () => {
  if (route) await route.close();
  process.env.CORTEX_MCP_TOKEN_UI_ENABLED = originalUiFlag;
});

function expectError(response: RouteResponse, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.json).toMatchObject({ success: false, error: { code } });
}

describe('default Cortex consent context route — real auth and permission middleware', () => {
  it('keeps the feature flag outside authentication and upstream access', async () => {
    process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'false';
    try {
      const response = await route.request('POST', true);
      expectError(response, 404, 'NOT_FOUND');
      expect(database.queries).toEqual([]);
      expect(route.callback.count).toBe(0);
    } finally {
      process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'true';
    }
  });

  it('requires a real FibreFlow session before method or database access', async () => {
    const response = await route.request('GET', false);

    expectError(response, 401, 'UNAUTHORIZED');
    expect(database.queries).toEqual([]);
    expect(route.callback.count).toBe(0);
  });

  it('authenticates before returning the POST-only method gate', async () => {
    const response = await route.request('GET', true);

    expectError(response, 405, 'METHOD_NOT_ALLOWED');
    expect(response.headers.get('allow')).toBe('POST');
    expect(database.queries).toHaveLength(1);
    expect(route.callback.count).toBe(0);
  });

  it('denies an authenticated user without cortex.review:view', async () => {
    const response = await route.request('POST', true);

    expectError(response, 403, 'FORBIDDEN');
    expect(response.json.error?.message).toBe(
      'Missing required permission: cortex.review',
    );
    expect(route.callback.count).toBe(0);
  });

  it('returns context only after real RBAC reaches the authenticated loopback', async () => {
    database.permissionResult = 'allow';

    const response = await route.request('POST', true);

    expect(response.status).toBe(200);
    expect(response.json.data).toEqual({
      clientId: 'route-client',
      clientName: 'Claude',
      redirectUri: 'https://evil.example/route-callback',
      scopes: ['cortex.read'],
    });
    expect(route.callback).toMatchObject({
      count: 1,
      path: '/authorize/context',
      stateId: 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g',
      authenticatedSecret: true,
    });
  });
});
