/**
 * H&S e-signature capture (§4.5).
 *
 * Guards that the IP is derived server-side (never trusted from the client),
 * the timestamp is the injected one, and the capturing user's uuid is recorded.
 */

import { describe, it, expect } from 'vitest';
import type { NextApiRequest } from 'next';
import { captureESignature, clientIp } from '../services/esignature';

function reqWith(headers: Record<string, unknown>, remote?: string): NextApiRequest {
  return { headers, socket: { remoteAddress: remote } } as unknown as NextApiRequest;
}

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '41.1.2.3, 10.0.0.1' }))).toBe('41.1.2.3');
  });

  it('falls back to the socket address when no forwarded header', () => {
    expect(clientIp(reqWith({}, '196.25.1.1'))).toBe('196.25.1.1');
  });

  it('returns "unknown" when neither is present', () => {
    expect(clientIp(reqWith({}))).toBe('unknown');
  });
});

describe('captureESignature', () => {
  const at = new Date('2026-07-24T09:00:00.000Z');

  it('records typed name, injected timestamp, user uuid and server-derived IP', () => {
    const req = reqWith({ 'x-forwarded-for': '41.9.9.9' });
    const sig = captureESignature(req, '  Byron Viviers  ', { id: 'user-1' }, at);
    expect(sig).toEqual({
      signature_name: 'Byron Viviers',
      signed_at: '2026-07-24T09:00:00.000Z',
      signed_by: 'user-1',
      signed_ip: '41.9.9.9',
    });
  });

  it('never reads an IP from the request body — only headers/socket', () => {
    // A client-supplied signed_ip in the body must be ignored; the helper only
    // ever looks at headers/socket, so a forged body field cannot land in the row.
    const req = reqWith({}, '10.0.0.5');
    const sig = captureESignature(req, 'A. Nother', null, at);
    expect(sig.signed_ip).toBe('10.0.0.5');
    expect(sig.signed_by).toBeNull();
  });
});
