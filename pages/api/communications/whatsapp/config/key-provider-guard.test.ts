/**
 * Pins that the generic config writer cannot be used to bypass the
 * super_admin gate on the provider flip.
 *
 * PUT /api/communications/whatsapp/config/[key] is withAuth-only, so without
 * this guard any authenticated user — a viewer — could set wa_provider through
 * it and the dedicated super_admin flip route would be decorative.
 *
 * Scope note: the same route can still write every other WA config key
 * (including the cloud_* secrets) at plain withAuth level. That is pre-existing
 * and deliberately left alone here; it is reported separately rather than
 * widened into this change.
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

import handler from './[key]';

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

describe('PUT /api/communications/whatsapp/config/[key] — wa_provider guard', () => {
  it.each(['viewer', 'technician', 'storeman', 'manager', 'admin'])(
    'refuses to let a %s write wa_provider through the generic config route',
    async (role) => {
      const res = await run('wa_provider', role);

      expect(res._getStatusCode()).toBe(403);
      expect(writes()).toHaveLength(0);
    }
  );

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
