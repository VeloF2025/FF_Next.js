/**
 * Pins that the test-send route is really auth-wrapped.
 *
 * Deliberately does NOT mock @/lib/auth. An unauthenticated caller must never
 * be able to make the server emit a WhatsApp message.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sendMock, readinessMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  readinessMock: vi.fn(),
}));

vi.mock('@/modules/communications/whatsapp/send/waSendClient', () => ({
  sendWhatsAppText: (...a: unknown[]) => sendMock(...a),
}));
vi.mock('@/modules/communications/whatsapp/config/waGoLive', () => ({
  getWaReadiness: (...a: unknown[]) => readinessMock(...a),
}));

import handler from './test-send';

describe('POST /api/communications/whatsapp/test-send — authentication', () => {
  it('rejects an unauthenticated request with 401 and never sends', async () => {
    sendMock.mockReset();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { toPhone: '27821234567' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a request bearing a garbage token', async () => {
    sendMock.mockReset();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      headers: { authorization: 'Bearer not-a-real-token' },
      body: { toPhone: '27821234567' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
