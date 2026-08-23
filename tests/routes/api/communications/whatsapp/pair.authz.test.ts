/**
 * Pins that requesting a WhatsApp pairing code needs more than a valid session.
 *
 * A pairing code is enough to link a device to the company WhatsApp account —
 * whoever enters it can read every future message in the monitored groups and
 * send as the business number. `withAuth` alone authenticates every role down
 * to 'viewer', so the role gate is the only thing standing between an ordinary
 * FibreFlow account and that capability.
 *
 * `withAuth` is stubbed here to inject a chosen role. `withRole` is NOT stubbed:
 * the real middleware runs, so this exercises the actual gate rather than a
 * local reimplementation of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { poolQueryMock, fetchMock, currentUser } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  fetchMock: vi.fn(),
  currentUser: { role: 'viewer' as string, id: 'user-1' },
}));

vi.mock('@neondatabase/serverless', () => ({
  neonConfig: {},
  neon: () => async () => [],
  Pool: class {
    query = (...a: unknown[]) => poolQueryMock(...a);
  },
}));
vi.mock('ws', () => ({ default: class {} }));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    // Stand in for a valid session; the real withRole still runs after this.
    withAuth: (handler: never) => (req: NextApiRequest, res: NextApiResponse) => {
      (req as unknown as { user: unknown }).user = { ...currentUser };
      return (handler as unknown as (r: NextApiRequest, s: NextApiResponse) => unknown)(req, res);
    },
  };
});

import handler from '@/pages/api/communications/whatsapp/services/[service]/pair';
import statusHandler from '@/pages/api/communications/whatsapp/services/[service]/pairing-status';

function callPair() {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    query: { service: 'bridge' },
    body: { phone_number: '+27785687945' },
  });
  return { req, res, run: () => handler(req, res) };
}

describe('POST /api/communications/whatsapp/services/[service]/pair — authorisation', () => {
  beforeEach(() => {
    poolQueryMock.mockReset();
    poolQueryMock.mockResolvedValue({ rows: [{ config_value: 'http://bridge.invalid' }] });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ pairing_code: 'AAAA-BBBB', phone_number: '+27785687945' }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  for (const role of ['viewer', 'technician', 'storeman', 'manager']) {
    it(`refuses a '${role}' and never asks the bridge for a code`, async () => {
      currentUser.role = role;
      const { res, run } = callPair();

      await run();

      expect(res._getStatusCode()).toBe(403);
      // The real damage is the bridge issuing a live code, so assert on the
      // call itself rather than only on the status.
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  for (const role of ['admin', 'system', 'super_admin']) {
    it(`lets an '${role}' through the role gate`, async () => {
      currentUser.role = role;
      const { res, run } = callPair();

      await run();

      expect(res._getStatusCode()).not.toBe(403);
      expect(fetchMock).toHaveBeenCalled();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/pair');
    });
  }

  it('sends the bridge secret when it forwards the request', async () => {
    process.env.WA_BRIDGE_SECRET = 'unit-test-value';
    currentUser.role = 'admin';
    const { run } = callPair();

    await run();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-bridge-secret']).toBe('unit-test-value');
    delete process.env.WA_BRIDGE_SECRET;
  });
});

describe('GET /api/communications/whatsapp/services/[service]/pairing-status — authorisation', () => {
  beforeEach(() => {
    poolQueryMock.mockReset();
    poolQueryMock.mockResolvedValue({ rows: [{ config_value: 'http://bridge.invalid' }] });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ pairing_code: 'AAAA-BBBB' }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  // Reading an outstanding code is as good as requesting one: whoever sees it
  // first can enter it on their own handset.
  it('refuses a non-admin and never reaches the bridge', async () => {
    currentUser.role = 'viewer';
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { service: 'bridge' },
    });

    await statusHandler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets an admin through', async () => {
    currentUser.role = 'admin';
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { service: 'bridge' },
    });

    await statusHandler(req, res);

    expect(res._getStatusCode()).not.toBe(403);
    expect(fetchMock).toHaveBeenCalled();
  });
});
