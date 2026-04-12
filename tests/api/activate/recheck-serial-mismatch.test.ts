import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: Function) => handler,
}));

vi.mock('@/modules/activate/services/serialRecheckService', () => ({
  runSerialRecheck: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import handler from '../../../pages/api/activate/recheck-serial-mismatch';
import { runSerialRecheck } from '@/modules/activate/services/serialRecheckService';

describe('POST /api/activate/recheck-serial-mismatch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 400 when dropNumber is missing', async () => {
    const { req, res } = createMocks({ method: 'POST', body: { source: 'manual' } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 405 for GET requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(405);
  });

  it('calls runSerialRecheck and returns 200 on success', async () => {
    vi.mocked(runSerialRecheck).mockResolvedValueOnce({
      outcome: 'correction',
      serialType: 'ups',
      secondPassSerial: 'GU18W12V2511020289',
      confidence: 0.92,
      waMessageSent: true,
      learningLogged: true,
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { dropNumber: 'DR474849', source: 'manual' },
    });

    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.data.outcome).toBe('correction');
    expect(data.data.waMessageSent).toBe(true);
  });
});
