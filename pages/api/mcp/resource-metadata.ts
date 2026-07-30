/**
 * RFC 9728 protected-resource metadata for FibreFlow-hosted MCP connectors.
 *
 * Served at /.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp via a rewrite
 * in next.config.js. This REPLACES the static file that used to live under public/,
 * which hardcoded https://app.fibreflow.app — so dev advertised PRODUCTION as its
 * authorization server, and a connector added against dev would send the user to prod
 * to authorize, where no service is running.
 *
 * Deliberately unauthenticated: this is discovery metadata a client reads BEFORE it has
 * any credential. It contains no secrets — only public URLs.
 *
 * Cortex uses the same host-aware route. That is required for the isolated dev
 * connector: a static production hostname would send dev authorization to the live
 * Cortex OAuth service.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The only hosts this endpoint will ever name as an authorization server.
 *
 * An allow-list, NOT "whatever the request claims". `authorization_servers` tells a
 * client where to send the user to authorize — pointing it at an attacker's host is
 * a phishing primitive, so the value must never be caller-controlled.
 *
 * An earlier revision derived the host from `x-forwarded-host` and argued the edge
 * would set it. It does not: the nginx configs in docs/VPS/ set `Host`, `X-Real-IP`,
 * `X-Forwarded-For` and `X-Forwarded-Proto`, and never touch `X-Forwarded-Host`, so a
 * client-supplied value passes straight through to the app.
 */
const ALLOWED_HOSTS = new Set([
  'app.fibreflow.app',
  'dev.fibreflow.app',
]);

const DEFAULT_BASE = 'https://app.fibreflow.app';

function isLocal(host: string): boolean {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

type Connector = 'fibreflow' | 'cortex';

const CONNECTORS: Record<Connector, { path: string; scope: string }> = {
  fibreflow: { path: 'ff-remote-mcp', scope: 'fibreflow.read' },
  cortex: { path: 'cortex-remote-mcp', scope: 'cortex.read' },
};

function resourceBase(headers: NextApiRequest['headers']): string {
  const pinned = (process.env.FF_APP_BASE ?? '').trim().replace(/\/$/, '');
  if (pinned) return pinned;

  const forwarded = headers['x-forwarded-host'];
  const candidates = [
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim(),
    headers.host,
  ];

  for (const host of candidates) {
    if (!host) continue;
    if (ALLOWED_HOSTS.has(host)) return `https://${host}`;
    // Local development only — never reachable through the public edge.
    if (isLocal(host)) return `http://${host}`;
  }
  // An unrecognised host gets production, not itself: a spoofed header must not be
  // able to make this document name an arbitrary authorization server.
  return DEFAULT_BASE;
}

export function buildResourceMetadata(
  headers: NextApiRequest['headers'],
  connector: Connector = 'fibreflow',
) {
  const base = resourceBase(headers);
  const { path, scope } = CONNECTORS[connector];

  return {
    resource: `${base}/api/${path}/mcp`,
    authorization_servers: [`${base}/api/${path}`],
    scopes_supported: [scope],
    bearer_methods_supported: ['header'],
  };
}

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  // Not `public`: the body varies by request host, and a shared cache keyed on path
  // alone could serve one environment's document to another's client. Cheap to
  // regenerate, so there is nothing to gain by caching it.
  res.setHeader('Cache-Control', 'no-store');

  const connector = req.query?.connector === 'cortex' ? 'cortex' : 'fibreflow';
  res.status(200).json(buildResourceMetadata(req.headers, connector));
}
