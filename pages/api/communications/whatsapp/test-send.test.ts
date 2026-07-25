/**
 * Behaviour tests for POST /api/communications/whatsapp/test-send.
 *
 * Auth wrappers are stubbed so the handler's own logic is under test; the stub
 * for withRole captures the role, so downgrading the gate turns this red. That
 * the route is genuinely auth-wrapped lives in test-send.auth.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sendMock, readinessMock, getProviderMock, queryMock, capturedRole } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  readinessMock: vi.fn(),
  getProviderMock: vi.fn(),
  queryMock: vi.fn(),
  capturedRole: { value: null as string | null },
}));

vi.mock('@/modules/communications/whatsapp/send/waSendClient', () => ({
  sendWhatsAppText: (...a: unknown[]) => sendMock(...a),
}));
vi.mock('@/modules/communications/whatsapp/config/waGoLive', () => ({
  getWaReadiness: (...a: unknown[]) => readinessMock(...a),
}));
vi.mock('@/modules/communications/whatsapp/config/waProviderConfig', () => ({
  getWaProvider: (...a: unknown[]) => getProviderMock(...a),
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

import handler from './test-send';

const CONFIGURED = { provider: 'bridge', cloudConfigured: true, cloudConfig: [] };

function run(body: unknown, method: 'POST' | 'GET' = 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, body });
  (req as unknown as { user: unknown }).user = { email: 'ops@velocityfibre.co.za', role: 'manager' };
  return handler(req, res).then(() => res);
}

beforeEach(() => {
  sendMock.mockReset();
  readinessMock.mockReset();
  getProviderMock.mockReset();
  queryMock.mockReset();
});

describe('POST /api/communications/whatsapp/test-send', () => {
  it('is gated at manager or above', () => {
    expect(capturedRole.value).toBe('manager');
  });

  it('rejects non-POST methods with 405 and never sends', async () => {
    const res = await run({}, 'GET');
    expect(res._getStatusCode()).toBe(405);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a missing or unusable phone number with 400 and never sends', async () => {
    readinessMock.mockResolvedValue(CONFIGURED);

    for (const body of [{}, { toPhone: '' }, { toPhone: 'not a phone' }, { toPhone: '12' }]) {
      const res = await run(body);
      expect(res._getStatusCode()).toBe(400);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends on the cloud channel explicitly, with the normalized number', async () => {
    readinessMock.mockResolvedValue(CONFIGURED);
    sendMock.mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.TEST' });

    const res = await run({ toPhone: '082 123 4567', message: 'hello from FibreFlow' });

    expect(res._getStatusCode()).toBe(200);
    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      toPhone: '27821234567',
      message: 'hello from FibreFlow',
      channel: 'cloud',
    });
    const body = JSON.parse(res._getData());
    expect(body.data).toMatchObject({ ok: true, channel: 'cloud', providerMessageId: 'wamid.TEST' });
  });

  it('falls back to a default message when none is supplied', async () => {
    readinessMock.mockResolvedValue(CONFIGURED);
    sendMock.mockResolvedValue({ ok: true, channel: 'cloud' });

    await run({ toPhone: '27821234567' });

    const sent = sendMock.mock.calls[0][0] as { message: string };
    expect(sent.message.length).toBeGreaterThan(0);
  });

  // The whole point of the task: incomplete creds must read as "not configured",
  // not as an opaque 500 the operator has to guess at.
  it('reports incomplete cloud credentials clearly and never attempts a send', async () => {
    readinessMock.mockResolvedValue({ provider: 'bridge', cloudConfigured: false, cloudConfig: [] });

    const res = await run({ toPhone: '27821234567' });

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.data).toMatchObject({ ok: false, notConfigured: true });
    expect(String(body.data.error)).toMatch(/not.*configured/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('surfaces the real send failure instead of a 500', async () => {
    readinessMock.mockResolvedValue(CONFIGURED);
    sendMock.mockResolvedValue({
      ok: false,
      channel: 'cloud',
      error: 'Graph 401: invalid access token',
      outcome: 'DEFINITELY_REJECTED',
    });

    const res = await run({ toPhone: '27821234567' });

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.data).toMatchObject({ ok: false, error: 'Graph 401: invalid access token' });
    expect(body.data.notConfigured).toBeUndefined();
  });

  // Hein-gated invariant: this action must never read or move the live provider.
  it('never reads or writes wa_provider', async () => {
    readinessMock.mockResolvedValue(CONFIGURED);
    sendMock.mockResolvedValue({ ok: true, channel: 'cloud' });

    await run({ toPhone: '27821234567' });

    expect(getProviderMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    // The channel is pinned to cloud rather than derived from configuration.
    expect((sendMock.mock.calls[0][0] as { channel: string }).channel).toBe('cloud');
  });

  it('returns 500 only when the readiness lookup itself blows up', async () => {
    readinessMock.mockRejectedValue(new Error('db down'));
    const res = await run({ toPhone: '27821234567' });
    expect(res._getStatusCode()).toBe(500);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
