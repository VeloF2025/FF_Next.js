/**
 * Pins that the generic config writer cannot be used to bypass the
 * super_admin gate on the provider flip, nor to tamper with the Cloud
 * credentials that gate is protecting.
 *
 * PUT /api/communications/whatsapp/config/[key] is withAuth-only, so without
 * these guards any authenticated user — a viewer — could:
 *   - set wa_provider directly, making the dedicated super_admin flip route
 *     decorative; or
 *   - overwrite cloud_app_secret and then forge a Meta webhook whose
 *     X-Hub-Signature-256 matches their own secret, because cloud-webhook.ts
 *     verifies the HMAC against whatever getWaCloudCreds() reads from the DB
 *     on that request (no caching); or
 *   - repoint cloud_access_token / cloud_phone_number_id at a WABA they
 *     control, exfiltrating recipient numbers and message text on the next
 *     Cloud send.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { poolQueryMock } = vi.hoisted(() => ({ poolQueryMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neonConfig: {},
  Pool: class {
    query = (...a: unknown[]) => poolQueryMock(...a);
  },
}));

vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h }));

import handler from '@/pages/api/communications/whatsapp/config/[key]';

function run(key: string, role: string, body: unknown = { config_value: 'cloud' }) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'PUT',
    query: { key },
    body,
  });
  (req as unknown as { user: unknown }).user = { email: 'someone@velocityfibre.co.za', role };
  return handler(req, res).then(() => res);
}

function writes() {
  return poolQueryMock.mock.calls
    .map((c) => String(c[0]).toUpperCase())
    .filter((s) => /\b(UPDATE|INSERT)\b/.test(s));
}

beforeEach(() => {
  poolQueryMock.mockReset();
});

const NON_SUPER_ADMIN_ROLES = ['viewer', 'technician', 'storeman', 'manager', 'admin'];

const PROTECTED_KEYS = [
  'wa_provider',
  'cloud_app_secret',
  'cloud_access_token',
  'cloud_phone_number_id',
  'cloud_verify_token',
];

describe('PUT /api/communications/whatsapp/config/[key] — provider & credential guard', () => {
  it.each(NON_SUPER_ADMIN_ROLES)(
    'refuses to let a %s write wa_provider through the generic config route',
    async (role) => {
      const res = await run('wa_provider', role);

      expect(res._getStatusCode()).toBe(403);
      expect(writes()).toHaveLength(0);
    }
  );

  // The Cloud credentials are the asset the provider gate exists to protect —
  // leaving them writable would make that gate cosmetic.
  it.each(PROTECTED_KEYS)('refuses to let a viewer write %s', async (key) => {
    const res = await run(key, 'viewer', { config_value: 'attacker-controlled' });

    expect(res._getStatusCode()).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it.each(NON_SUPER_ADMIN_ROLES)('refuses to let a %s overwrite cloud_app_secret', async (role) => {
    const res = await run('cloud_app_secret', role, { config_value: 'attacker-known-secret' });

    expect(res._getStatusCode()).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('lets a super_admin through to the normal config path', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          id: '1',
          config_key: 'wa_provider',
          config_value: 'bridge',
          config_type: 'string',
          category: 'provider',
          is_sensitive: false,
        },
      ],
    });

    const res = await run('wa_provider', 'super_admin');

    expect(res._getStatusCode()).toBe(200);
    expect(writes().some((s) => s.includes('UPDATE'))).toBe(true);
  });

  // Attribution must come from the authenticated session, not from a header
  // the caller controls — otherwise the audit trail can name anyone.
  it('attributes the change to the authenticated user, not the x-user-email header', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          id: '1',
          config_key: 'wa_provider',
          config_value: 'bridge',
          config_type: 'string',
          category: 'provider',
          is_sensitive: false,
        },
      ],
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'PUT',
      query: { key: 'wa_provider' },
      body: { config_value: 'cloud' },
      headers: { 'x-user-email': 'spoofed@attacker.example' },
    });
    (req as unknown as { user: unknown }).user = { email: 'real@velocityfibre.co.za', role: 'super_admin' };

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);

    const allParams = poolQueryMock.mock.calls.flatMap((c) => (Array.isArray(c[1]) ? c[1] : []));
    expect(allParams).toContain('real@velocityfibre.co.za');
    expect(allParams).not.toContain('spoofed@attacker.example');
  });

  it('leaves writes to other config keys untouched', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          id: '2',
          config_key: 'log_retention_days',
          config_value: '30',
          config_type: 'number',
          category: 'general',
          is_sensitive: false,
        },
      ],
    });

    const res = await run('log_retention_days', 'manager', { config_value: '45' });

    expect(res._getStatusCode()).toBe(200);
  });
});
