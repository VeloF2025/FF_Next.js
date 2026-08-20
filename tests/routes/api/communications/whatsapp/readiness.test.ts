/**
 * Behaviour tests for GET /api/communications/whatsapp/readiness.
 *
 * The auth wrappers are stubbed here so the handler's own logic is what is
 * under test — but the stub for withRole *captures* the role it was handed, so
 * downgrading the gate turns this file red. That the route is genuinely
 * auth-wrapped is pinned separately in readiness.auth.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { queryMock, capturedRole } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  capturedRole: { value: null as string | null },
}));

vi.mock('@/lib/db-pool', () => ({
  query: (...a: unknown[]) => queryMock(...a),
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: (role: string) => {
    capturedRole.value = role;
    return (h: unknown) => h;
  },
}));

import handler from '@/pages/api/communications/whatsapp/readiness';

function run(method: 'GET' | 'POST' = 'GET') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method });
  return handler(req, res).then(() => res);
}

// Block body, not an implicit return: mockReset() returns the mock itself, and
// Vitest treats a hook's returned function as a teardown callback — it would
// then *call* queryMock after each test, firing the rejecting implementation
// below with nobody awaiting it (an unhandled rejection that fails the test).
beforeEach(() => {
  queryMock.mockReset();
});

describe('GET /api/communications/whatsapp/readiness', () => {
  it('is gated at manager or above', () => {
    expect(capturedRole.value).toBe('manager');
  });

  it('rejects non-GET methods with 405 and never touches the DB', async () => {
    const res = await run('POST');
    expect(res._getStatusCode()).toBe(405);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns the provider plus presence-only cloud config', async () => {
    queryMock.mockResolvedValue([
      { config_key: 'wa_provider', config_value: 'bridge' },
      { config_key: 'cloud_phone_number_id', config_value: '123456789' },
      { config_key: 'cloud_access_token', config_value: '' },
    ]);

    const res = await run('GET');

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe('bridge');
    expect(body.data.cloudConfigured).toBe(false);
    expect(body.data.cloudConfig).toEqual([
      { key: 'cloud_phone_number_id', present: true },
      { key: 'cloud_access_token', present: false },
      { key: 'cloud_app_secret', present: false },
      { key: 'cloud_verify_token', present: false },
    ]);
  });

  it('never sends a config value over the wire', async () => {
    queryMock.mockResolvedValue([
      { config_key: 'wa_provider', config_value: 'cloud' },
      { config_key: 'cloud_access_token', config_value: 'EAAG-live-token' },
      { config_key: 'cloud_app_secret', config_value: 'live-app-secret' },
    ]);

    const res = await run('GET');

    expect(res._getData()).not.toContain('EAAG-live-token');
    expect(res._getData()).not.toContain('live-app-secret');
  });

  it('is read-only — it never issues a write', async () => {
    queryMock.mockResolvedValue([]);
    await run('GET');
    const statements = queryMock.mock.calls.map((c) => String(c[0]).toUpperCase());
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('SELECT');
    expect(statements[0]).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
  });

  it('returns 500 when the config read fails', async () => {
    queryMock.mockRejectedValue(new Error('db down'));
    const res = await run('GET');
    expect(res._getStatusCode()).toBe(500);
  });
});
