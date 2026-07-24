/**
 * H&S e-signature capture (§4.5).
 *
 * Guards that the IP is derived server-side (never trusted from the client),
 * the timestamp is the injected one, and the capturing user's uuid is recorded.
 */

import { describe, it, expect } from 'vitest';
import type { NextApiRequest } from 'next';
import { captureESignature, clientIp } from '../services/esignature';

function reqWith(headers: Record<string, unknown>, remote?: string, body?: unknown): NextApiRequest {
  return { headers, socket: { remoteAddress: remote }, body } as unknown as NextApiRequest;
}

describe('clientIp', () => {
  it('takes the rightmost PUBLIC hop, skipping internal proxy hops', () => {
    // Real chain behind two proxies: <real client>, <inner nginx>, <app localhost>.
    expect(clientIp(reqWith({ 'x-forwarded-for': '105.209.144.156, 10.0.0.1, 127.0.0.1' }))).toBe('105.209.144.156');
  });

  it('ignores a client-forged public first hop and keeps the real appended one', () => {
    // A client sends its own X-Forwarded-For: 8.8.8.8 → nginx appends the real
    // client + proxy hops to the right; the forged leading entry must NOT win.
    expect(clientIp(reqWith({ 'x-forwarded-for': '8.8.8.8, 196.25.99.1, 127.0.0.1' }))).toBe('196.25.99.1');
  });

  it('handles a single public hop', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '41.1.2.3' }))).toBe('41.1.2.3');
  });

  it('falls back to the last hop when every hop is internal (same-host request)', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '10.0.0.1, 127.0.0.1' }))).toBe('127.0.0.1');
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

  it('ignores a signed_ip supplied in the request body — audit IP is server-derived', () => {
    // Pin the invariant: even if a client crafts signed_ip into the body, the
    // captured value comes only from headers/socket.
    const req = reqWith({}, '10.0.0.5', { signed_ip: '203.0.113.7', signed_by: 'attacker' });
    const sig = captureESignature(req, 'A. Nother', null, at);
    expect(sig.signed_ip).toBe('10.0.0.5');
    expect(sig.signed_by).toBeNull();
  });
});
