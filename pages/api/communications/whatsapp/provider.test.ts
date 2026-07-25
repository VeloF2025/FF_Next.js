/**
 * Behaviour tests for PUT /api/communications/whatsapp/provider — the
 * wa_provider flip.
 *
 * Every config value here is mocked. This flip is Hein-gated in production and
 * is never exercised against live credentials.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { queryMock, readinessMock, capturedRole } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  readinessMock: vi.fn(),
  capturedRole: { value: null as string | null },
}));

vi.mock('@/lib/db-pool', () => ({
  query: (...a: unknown[]) => queryMock(...a),
}));
vi.mock('@/modules/communications/whatsapp/config/waGoLive', () => ({
  getWaReadiness: (...a: unknown[]) => readinessMock(...a),
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: (role: string) => {
    capturedRole.value = role;
    return (h: unknown) => h;
  },
}));

import handler from './provider';

const CLOUD_READY = { provider: 'bridge', cloudConfigured: true, cloudConfig: [] };
const CLOUD_NOT_READY = { provider: 'bridge', cloudConfigured: false, cloudConfig: [] };

function run(body: unknown, method: 'PUT' | 'GET' = 'PUT') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, body });
  (req as unknown as { user: unknown }).user = { email: 'hein@velocityfibre.co.za', role: 'super_admin' };
  return handler(req, res).then(() => res);
}

/** SQL statements the handler actually issued, upper-cased. */
function statements() {
  return queryMock.mock.calls.map((c) => String(c[0]).toUpperCase());
}

function writes() {
  return statements().filter((s) => /\b(UPDATE|INSERT|DELETE)\b/.test(s));
}

/** UPDATE succeeds and returns the new value; the audit INSERT returns nothing. */
function mockFlipSucceeds(newValue: string) {
  queryMock.mockImplementation(async (text: string) =>
    String(text).toUpperCase().includes('UPDATE') ? [{ config_value: newValue }] : []
  );
}

beforeEach(() => {
  queryMock.mockReset();
  readinessMock.mockReset();
});

describe('PUT /api/communications/whatsapp/provider', () => {
  it('is gated at super_admin', () => {
    expect(capturedRole.value).toBe('super_admin');
  });

  it('rejects non-PUT methods with 405 and never writes', async () => {
    const res = await run({}, 'GET');
    expect(res._getStatusCode()).toBe(405);
    expect(writes()).toHaveLength(0);
  });

  it('rejects an unknown provider value and never writes', async () => {
    for (const provider of [undefined, '', 'waha', 'CLOUD ', 'bridge; DROP TABLE x']) {
      const res = await run({ provider, confirm: true });
      expect(res._getStatusCode()).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });

  // The confirmation is enforced server-side too, so a stray or replayed
  // request cannot move the live provider on its own.
  it('refuses to flip without an explicit confirmation and never writes', async () => {
    readinessMock.mockResolvedValue(CLOUD_READY);

    const res = await run({ provider: 'cloud' });

    expect(res._getStatusCode()).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  // Fails closed: flipping to cloud with missing creds would take 1:1 sending
  // down, so readiness is a precondition, not a warning.
  it('refuses to switch to cloud while credentials are incomplete', async () => {
    readinessMock.mockResolvedValue(CLOUD_NOT_READY);

    const res = await run({ provider: 'cloud', confirm: true });

    expect(res._getStatusCode()).toBe(409);
    expect(writes()).toHaveLength(0);
    expect(String(JSON.parse(res._getData()).error)).toMatch(/not.*configured/i);
  });

  it('flips to cloud when credentials are complete and confirmation is given', async () => {
    readinessMock.mockResolvedValue(CLOUD_READY);
    mockFlipSucceeds('cloud');

    const res = await run({ provider: 'cloud', confirm: true });

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data).toMatchObject({ provider: 'cloud' });

    const update = queryMock.mock.calls.find((c) => String(c[0]).toUpperCase().includes('UPDATE'));
    expect(update).toBeDefined();
    expect(String(update?.[0])).toContain('wa_service_config');
    expect(update?.[1]).toContain('cloud');
  });

  // Reverting to the bridge is the rollback path — it must never be blocked by
  // the state of the cloud credentials.
  it('always allows switching back to bridge, even with no cloud credentials', async () => {
    readinessMock.mockResolvedValue(CLOUD_NOT_READY);
    mockFlipSucceeds('bridge');

    const res = await run({ provider: 'bridge', confirm: true });

    expect(res._getStatusCode()).toBe(200);
    expect(writes().some((s) => s.includes('UPDATE'))).toBe(true);
  });

  it('records the flip in the admin audit log with the authenticated user', async () => {
    readinessMock.mockResolvedValue(CLOUD_READY);
    mockFlipSucceeds('cloud');

    await run({ provider: 'cloud', confirm: true });

    const audit = queryMock.mock.calls.find((c) => String(c[0]).toUpperCase().includes('INSERT'));
    expect(String(audit?.[0])).toContain('wa_admin_audit_log');
    expect(audit?.[1]).toContain('hein@velocityfibre.co.za');
  });

  // "Switched to cloud" is only half the story — an audit trail for the
  // highest-risk action here has to answer what it was switched FROM.
  it('records the previous provider as the audit old_value', async () => {
    readinessMock.mockResolvedValue(CLOUD_READY);
    queryMock.mockImplementation(async (text: string) => {
      const sql = String(text).toUpperCase();
      if (sql.includes('UPDATE')) return [{ config_value: 'cloud' }];
      if (sql.includes('SELECT')) return [{ config_value: 'bridge' }];
      return [];
    });

    await run({ provider: 'cloud', confirm: true });

    const audit = queryMock.mock.calls.find((c) => String(c[0]).toUpperCase().includes('INSERT'));
    const oldValue = (audit?.[1] as unknown[])?.find(
      (p) => typeof p === 'string' && p.includes('bridge')
    );
    expect(oldValue).toBeDefined();
  });

  it('still flips when the previous value cannot be read', async () => {
    readinessMock.mockResolvedValue(CLOUD_READY);
    queryMock.mockImplementation(async (text: string) => {
      const sql = String(text).toUpperCase();
      if (sql.includes('UPDATE')) return [{ config_value: 'cloud' }];
      if (sql.includes('SELECT')) throw new Error('read failed');
      return [];
    });

    const res = await run({ provider: 'cloud', confirm: true });

    expect(res._getStatusCode()).toBe(200);
  });

  it('reports 404 when there is no wa_provider row to update', async () => {
    readinessMock.mockResolvedValue(CLOUD_READY);
    queryMock.mockResolvedValue([]);

    const res = await run({ provider: 'cloud', confirm: true });

    expect(res._getStatusCode()).toBe(404);
  });

  it('still reports success when only the audit write fails', async () => {
    readinessMock.mockResolvedValue(CLOUD_READY);
    queryMock.mockImplementation(async (text: string) => {
      if (String(text).toUpperCase().includes('UPDATE')) return [{ config_value: 'cloud' }];
      throw new Error('audit table unavailable');
    });

    const res = await run({ provider: 'cloud', confirm: true });

    expect(res._getStatusCode()).toBe(200);
  });

  it('returns 500 when the update itself fails', async () => {
    readinessMock.mockResolvedValue(CLOUD_READY);
    queryMock.mockRejectedValue(new Error('db down'));

    const res = await run({ provider: 'cloud', confirm: true });

    expect(res._getStatusCode()).toBe(500);
  });
});
