/**
 * Auth for the construction-qa photo-proxy `?vlm=true` path.
 *
 * SERVER-ONLY — never import from a client component (it reads a non-public env
 * secret). The VLM (vLLM) fetches image URLs with a plain GET and cannot send
 * headers, so the only place an internal caller can carry a credential is the
 * query string. This replaces the previous peer-IP check, which was NOT a real
 * boundary: nginx reverse-proxies to Node over loopback, so EVERY request's
 * `remoteAddress` is 127.0.0.1 — any anonymous client could pass `?vlm=true` and
 * fetch any photo by key (see project_photo_proxy_vlm_auth_bypass).
 *
 * Trade-off: the secret rides in the URL, so it appears in velo's (trusted,
 * on-box) nginx access logs. That is acceptable because VLM_PROXY_SECRET is
 * dedicated to photo-read only (NOT CRON_SECRET), is rotatable, and the proxy
 * only serves photos. Fail-closed: with no secret configured the `vlm=true`
 * path is denied and the request falls through to session auth.
 */
import { timingSafeEqual } from 'crypto';

export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard first (length is not secret).
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * True when a request is authorised to use the `vlm=true` photo-proxy path:
 * `vlm=true` AND a configured `VLM_PROXY_SECRET` AND a matching `vlmkey` param.
 */
export function isVlmProxyAuthorized(query: {
  vlm?: string | string[];
  vlmkey?: string | string[];
}): boolean {
  const expected = process.env.VLM_PROXY_SECRET;
  if (!expected) return false; // fail closed — no secret configured
  if (query.vlm !== 'true') return false;
  const provided = query.vlmkey;
  if (typeof provided !== 'string') return false;
  return secretsMatch(provided, expected);
}

/**
 * Query-string fragment (`&vlm=true&vlmkey=<secret>`) that internal callers
 * append to a photo-proxy URL so the VLM/loopback fetch is authorised. Returns
 * an empty string when no secret is configured (fail-closed — the proxy will
 * then require a session, surfacing the misconfiguration instead of leaking).
 */
export function vlmProxyKeyParam(): string {
  const secret = process.env.VLM_PROXY_SECRET;
  return secret ? `&vlm=true&vlmkey=${encodeURIComponent(secret)}` : '&vlm=true';
}
