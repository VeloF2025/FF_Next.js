/**
 * H&S appointment-letter sign flow (§4.5 drawn signature).
 *
 * Guards the invariants a blind UI can't be trusted with: the signature image
 * must be a bounded PNG data URL, and a signed letter is locked (409).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/auth', () => ({
  
  withPermission: () => (h: unknown) => h,
  withAuth: (h: (req: NextApiRequest, res: NextApiResponse) => unknown) => h,
  getAuthUser: vi.fn(() => ({ id: 'user-1', email: 'a@velocityfibre.co.za' })),
}));

import handler from '../../../../pages/api/health-safety/appointments/[letterId]';

const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function patch(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'PATCH', query: { letterId: 'l1' }, body, headers,
  });
  await handler(req, res);
  return res;
}

describe('PATCH /api/health-safety/appointments/[letterId] — sign flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-PNG-data-URL signature', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'l1', status: 'draft', reference_number: 'APPT-1' }]);
    const res = await patch({ signature_image: 'javascript:alert(1)' });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).toHaveBeenCalledTimes(1); // load only, no UPDATE
  });

  it('accepts a valid PNG data URL and marks the letter signed', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'l1', status: 'draft', reference_number: 'APPT-1' }]) // load
      .mockResolvedValueOnce([{ id: 'l1', reference_number: 'APPT-1', status: 'signed' }]); // update
    const res = await patch({ signature_image: VALID_PNG, signature_name: 'Jane' }, { 'x-forwarded-for': '41.1.2.3' });
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data.status).toBe('signed');
  });

  it('locks a signed letter against further changes (409)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'l1', status: 'signed', reference_number: 'APPT-1' }]);
    const res = await patch({ scope: 'tampered' });
    expect(res._getStatusCode()).toBe(409);
    expect(sqlMock).toHaveBeenCalledTimes(1); // no UPDATE
  });

  it('does not read signed_ip from the request body', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'l1', status: 'draft', reference_number: 'APPT-1' }])
      .mockResolvedValueOnce([{ id: 'l1', reference_number: 'APPT-1', status: 'signed' }]);
    await patch({ signature_image: VALID_PNG, signed_ip: '9.9.9.9' }, { 'x-forwarded-for': '41.1.2.3' });
    // The UPDATE call binds the server-derived IP (41.1.2.3), never 9.9.9.9.
    const updateCall = sqlMock.mock.calls.find((c) => (c[0] as string[]).join('').includes("status = 'signed'"));
    expect(updateCall?.slice(1)).toContain('41.1.2.3');
    expect(updateCall?.slice(1)).not.toContain('9.9.9.9');
  });
});
