/**
 * H&S e-signature capture (goal §4.5)
 *
 * A signature is a typed name + timestamp + the capturing app user's uuid + the
 * request IP — NOT a drawn canvas and NOT a third-party service. Reused by
 * toolbox-talk attendance (Phase 2) and PPE acknowledgement (Phase 3). The
 * statutory appointment letters (Phase 5) use a drawn signature instead
 * (Hein, §4.5 decision) and do not go through this helper.
 *
 * The IP is derived server-side from the request, never accepted from the
 * client, so it cannot be forged in the signed record.
 */

import type { NextApiRequest } from 'next';

export interface ESignature {
  /** The name the signer typed as their acknowledgement. */
  signature_name: string;
  /** ISO timestamp the signature was captured. */
  signed_at: string;
  /** uuid of the authenticated app user who captured the signature. */
  signed_by: string | null;
  /** Request IP, derived server-side. */
  signed_ip: string;
}

/** Loopback / RFC1918 private / IPv6 ULA — the proxy hops, not a real client. */
function isInternalIp(ip: string): boolean {
  return (
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^(fc|fd)[0-9a-f]{2}:/i.test(ip) ||
    ip.startsWith('::ffff:127.') ||
    ip.startsWith('::ffff:10.') ||
    ip.startsWith('::ffff:192.168.')
  );
}

/**
 * The signer's real IP for the audit trail.
 *
 * nginx uses `$proxy_add_x_forwarded_for`, which APPENDS each proxy's observed
 * upstream IP to the right, so the chain reads:
 *   <client-forged entries…>, <real client>, <internal proxy hops…>
 * A client can only inject entries at the LEFT (first-hop is spoofable); it can
 * never insert one to the right of the real hops. So the rightmost PUBLIC hop
 * is the real client and is unforgeable — walk from the right, skip the
 * internal proxy hops (this deployment has more than one), and take the first
 * public address. This is deliberately stricter than the first-hop idiom used
 * for non-audit logging: signed_ip feeds a legal §4.5 e-signature.
 */
export function clientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    const hops = fwd.split(',').map((h) => h.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isInternalIp(hops[i]!)) return hops[i]!;
    }
    // All hops internal (same-host request) — the last hop is the best we have.
    if (hops.length > 0) return hops[hops.length - 1]!;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Build a signature record. `signedAt` is injected (never `new Date()` inside a
 * pure builder) so callers control the timestamp and it stays testable.
 */
export function captureESignature(
  req: NextApiRequest,
  typedName: string,
  user: { id?: string } | null,
  signedAt: Date
): ESignature {
  return {
    signature_name: typedName.trim(),
    signed_at: signedAt.toISOString(),
    signed_by: user?.id ?? null,
    signed_ip: clientIp(req),
  };
}
