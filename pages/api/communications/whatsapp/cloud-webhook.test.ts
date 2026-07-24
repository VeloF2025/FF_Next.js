import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/modules/communications/whatsapp/config/waProviderConfig', () => ({
  getWaCloudCreds: vi.fn(),
}));
import { getWaCloudCreds } from '@/modules/communications/whatsapp/config/waProviderConfig';
import handler from './cloud-webhook';

function mockRes() {
  const res: Partial<NextApiResponse> & { _status?: number; _body?: unknown } = {};
  res.status = vi.fn().mockImplementation((s: number) => { res._status = s; return res as NextApiResponse; });
  res.json = vi.fn().mockImplementation((b: unknown) => { res._body = b; return res as NextApiResponse; });
  res.send = vi.fn().mockImplementation((b: unknown) => { res._body = b; return res as NextApiResponse; });
  res.end = vi.fn();
  return res as NextApiResponse & { _status?: number; _body?: unknown };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('GET cloud-webhook verify handshake', () => {
  it('echoes hub.challenge when the verify token matches', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue({ phoneNumberId: 'PN', accessToken: 'T', appSecret: 'S', verifyToken: 'VER' });
    const req = { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'VER', 'hub.challenge': '99' } } as unknown as NextApiRequest;
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toBe('99');
  });

  it('403s on token mismatch', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue({ phoneNumberId: 'PN', accessToken: 'T', appSecret: 'S', verifyToken: 'VER' });
    const req = { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'WRONG', 'hub.challenge': '99' } } as unknown as NextApiRequest;
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });
});
