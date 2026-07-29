/**
 * RFC 9728 protected-resource metadata for the FibreFlow remote MCP connector.
 *
 * Served at /.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp via a rewrite
 * in next.config.js. This REPLACES the static file that used to live under public/,
 * which hardcoded https://app.fibreflow.app — so dev advertised PRODUCTION as its
 * authorization server, and a connector added against dev would send the user to prod
 * to authorize, where no service is running. The value has to follow the host the
 * request actually arrived on.
 *
 * Deliberately unauthenticated: this is discovery metadata that a client reads BEFORE
 * it has any credential. It contains no secrets — only public URLs.
 *
 * The Cortex sibling (public/.well-known/.../api/cortex-remote-mcp/mcp) is left as a
 * static file: it only ever runs on production, so a fixed host is correct there.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Trust x-forwarded-host only from the known edge. Both deploy targets sit behind
 * nginx/Cloudflare, which set it; a direct caller can spoof the Host header, but the
 * worst case is that the spoofer receives metadata pointing at their own host — they
 * learn nothing and no other user is affected. FF_APP_BASE pins it where that
 * reasoning is not good enough.
 */
function resourceBase(req: NextApiRequest): string {
  const pinned = (process.env.FF_APP_BASE ?? '').trim().replace(/\/$/, '');
  if (pinned) return pinned;

  const forwarded = req.headers['x-forwarded-host'];
  const host =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ||
    req.headers.host ||
    'app.fibreflow.app';
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const base = resourceBase(req);
  // Short cache: the value is host-derived, and a stale copy pinned to the wrong
  // environment is exactly the failure this route exists to prevent.
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    resource: `${base}/api/ff-remote-mcp/mcp`,
    authorization_servers: [`${base}/api/ff-remote-mcp`],
    scopes_supported: ['fibreflow.read'],
    bearer_methods_supported: ['header'],
  });
}
