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

/**
 * The signer's real IP for the audit trail.
 *
 * Velocity's nginx uses `$proxy_add_x_forwarded_for`, which APPENDS the real
 * upstream socket address to whatever the client sent — so the LAST hop is the
 * IP nginx actually observed and the client cannot forge it, whereas the first
 * hop is client-controlled. Taking the last hop is deliberately different from
 * the first-hop idiom used for non-audit logging elsewhere: this value feeds a
 * legal §4.5 e-signature and must not be spoofable. (Assumes the single trusted
 * nginx in front of the app; add-a-CDN would need the trusted-proxy count
 * revisited.)
 */
export function clientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    const hops = fwd.split(',').map((h) => h.trim()).filter(Boolean);
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
