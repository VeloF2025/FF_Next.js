/**
 * Short-lived signed links for photo download.
 *
 * SERVER-ONLY — reads a non-public secret. Never import from a client component.
 *
 * Why signatures rather than session auth: the downloader is Claude's Cowork sandbox,
 * which holds no FibreFlow session and cannot be given one. A link is the only
 * credential that reaches it. So RBAC is evaluated ONCE, when the manifest is minted
 * for an authenticated user, and the resulting links carry that decision.
 *
 * That makes each link a bearer credential, which is why:
 *   - it expires (LINK_TTL_SECONDS),
 *   - it is bound to ONE photo key, so a leaked link cannot be walked into another, and
 *   - the user id is inside the signed payload, so grants stay attributable in the logs.
 *
 * Same trade-off already accepted for VLM_PROXY_SECRET in vlm/photoProxyAuth.ts: the
 * credential rides in the URL and so appears in velo's on-box nginx access logs.
 */
import { createHmac } from 'crypto';

import { secretsMatch } from '@/lib/vlm/photoProxyAuth';

/** Long enough for a gigabyte-scale pull to finish, short enough that a stray link dies. */
export const LINK_TTL_SECONDS = 60 * 60;

export type LinkVerdict = 'ok' | 'expired' | 'invalid' | 'unconfigured';

/**
 * Canonical signing string. Keys are sorted so callers cannot change the signature by
 * reordering arguments, and values are length-prefixed so no combination of values can
 * impersonate another: without it, {a: "x", b: "yz"} and {a: "xy", b: "z"} sign the same.
 */
function canonical(parts: Record<string, string | number>, exp: number): string {
  const entries = Object.entries({ ...parts, exp }).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}:${String(v).length}:${String(v)}`).join('|');
}

function sign(parts: Record<string, string | number>, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(canonical(parts, exp)).digest('hex');
}

export function isConfigured(): boolean {
  return Boolean(process.env.PHOTO_LINK_SECRET);
}

/**
 * Sign a set of parts. Returns null when no secret is configured — callers must treat
 * that as "this feature is off", never as "skip the signature".
 */
export function signLink(
  parts: Record<string, string | number>,
  ttlSeconds: number = LINK_TTL_SECONDS,
): { exp: number; sig: string } | null {
  const secret = process.env.PHOTO_LINK_SECRET;
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { exp, sig: sign(parts, exp, secret) };
}

/**
 * Verify parts against a presented exp/sig.
 *
 * Expiry is checked AFTER the signature: reporting "expired" for an unsigned guess would
 * confirm that the rest of the payload was otherwise acceptable.
 */
export function verifyLink(
  parts: Record<string, string | number>,
  exp: unknown,
  sig: unknown,
): LinkVerdict {
  const secret = process.env.PHOTO_LINK_SECRET;
  if (!secret) return 'unconfigured'; // fail closed
  if (typeof sig !== 'string' || typeof exp !== 'string') return 'invalid';

  const expSeconds = Number(exp);
  if (!Number.isSafeInteger(expSeconds)) return 'invalid';

  if (!secretsMatch(sig, sign(parts, expSeconds, secret))) return 'invalid';
  if (expSeconds < Math.floor(Date.now() / 1000)) return 'expired';
  return 'ok';
}
