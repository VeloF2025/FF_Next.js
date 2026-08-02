/**
 * Shared OAuth edge rate limiting for the public MCP proxies.
 *
 * Both `pages/api/cortex-remote-mcp/[...path].ts` and `pages/api/ff-remote-mcp/[...path].ts`
 * expose an unauthenticated OAuth 2.1 register/authorize surface to the internet, so both
 * need the same bound. This lives here instead of being copied into each route because
 * copying is exactly what left ff-remote-mcp without the limiter while its twin had one —
 * the same drift `./proxyStream.ts` was extracted to stop.
 *
 * Buckets are keyed per proxy: the two upstreams are separate services and must not share
 * a quota, or traffic to one would throttle the other.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isIP } from 'node:net';
import { log } from '@/lib/logger';
import rateLimiter from '@/lib/rateLimiter';

export const OAUTH_RATE_WINDOW_MS = 60 * 1000;

/** Per-minute ceilings. Registration is the more expensive upstream operation. */
const REGISTER_LIMIT = 30;
const AUTHORIZE_LIMIT = 60;

interface OAuthRateLimitPolicy {
  endpoint: string;
  limit: number;
}

/**
 * The client address to bucket on.
 *
 * `x-real-ip` is set by our own nginx, and is validated as a bare IP literal before use.
 * Anything else — absent, malformed, or a comma-joined list injected by the caller —
 * falls back to the socket address. Trusting the header unvalidated would let a caller
 * pick their own bucket key and evade the limit outright, which is the same evasion
 * X-Forwarded-For rotation offers; neither is trusted.
 */
export function trustedClientIp(req: NextApiRequest): string {
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    const candidate = realIp.trim();
    if (isIP(candidate)) return candidate;
  }

  // `socket` is optional-chained deliberately. Node always provides one in production, but
  // this helper is now shared by two routes and reached from test harnesses with lighter
  // request mocks — and a throw here would 500 the whole proxy from inside its rate
  // limiter. Falling back to the shared 'unknown' bucket still limits the caller; it fails
  // closed rather than open.
  const socketIp = req.socket?.remoteAddress?.trim();
  return socketIp && isIP(socketIp) ? socketIp : 'unknown';
}

function policyFor(
  req: NextApiRequest,
  targetPath: string,
  bucketPrefix: string,
): OAuthRateLimitPolicy | null {
  if (req.method === 'POST' && targetPath === '/register') {
    return { endpoint: `${bucketPrefix}-oauth-register`, limit: REGISTER_LIMIT };
  }
  if (req.method === 'GET' && targetPath === '/authorize') {
    return { endpoint: `${bucketPrefix}-oauth-authorize`, limit: AUTHORIZE_LIMIT };
  }
  return null;
}

/**
 * Apply the OAuth bucket for this request.
 *
 * Call this BEFORE reading the request body, so a throttled caller cannot make us buffer
 * their payload first. Returns `false` when the request was rejected — a 429 has already
 * been written and the caller must return immediately.
 *
 * Nothing from the query string is logged or included in the key: `state` and friends are
 * per-attempt values, so keying on them would create one bucket per attempt (no limit at
 * all) and logging them would leak OAuth parameters.
 */
export function applyOAuthRateLimit(
  req: NextApiRequest,
  res: NextApiResponse,
  targetPath: string,
  bucketPrefix: string,
): boolean {
  const policy = policyFor(req, targetPath, bucketPrefix);
  if (!policy) return true;

  const clientIp = trustedClientIp(req);
  const result = rateLimiter.check(
    `${policy.endpoint}:${clientIp}`,
    policy.limit,
    OAUTH_RATE_WINDOW_MS,
  );
  if (result.success) return true;

  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  log.warn('MCP OAuth edge rate limit exceeded', {
    endpoint: policy.endpoint,
    clientIp,
  });
  res.setHeader('Retry-After', retryAfter);
  res.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many OAuth requests' },
  });
  return false;
}
