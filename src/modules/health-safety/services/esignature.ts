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

/** First hop of x-forwarded-for (nginx sets it), else the socket address. */
export function clientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
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
