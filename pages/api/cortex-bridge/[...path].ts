/**
 * Public Cortex Bridge proxy for remote MCP/API clients.
 *
 * Why this exists: the separate Cortex public hostname can be blocked by edge policy
 * before non-browser MCP clients reach the bridge. FibreFlow already has a stable
 * production surface, so remote clients use app.fibreflow.app/api/cortex-bridge.
 *
 * Security model:
 * - Requires Authorization: Bearer credential; no FibreFlow cookie fallback.
 * - Forwards only whitelisted Cortex API prefixes.
 * - Does not inject CORTEX_API_KEY or any service credential.
 * - Upstream bridge remains the real auth/ACL enforcement point.
 */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';

const DEFAULT_BRIDGE_URL = ['http:', '', 'localhost:7403'].join('/');
const BRIDGE_URL = (process.env.CORTEX_BRIDGE_URL ?? DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_PREFIXES = [
  '/api/query',
  '/api/answer',
  '/api/timeline',
  '/api/facts',
  '/api/entity-profile',
  '/api/meetings',
  '/api/mcp-tokens/revoke',
];

function requestedPath(req: NextApiRequest): string {
  const raw = req.query.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return `/${parts.map((part) => encodeURIComponent(part)).join('/')}`;
}

function hasUnsafeDotSegment(req: NextApiRequest): boolean {
  const raw = req.query.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return parts.some((part) => part === '.' || part === '..');
}

function hasAllowedPrefix(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function buildUpstreamUrl(req: NextApiRequest, path: string): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path') continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item === 'string') query.append(key, item);
    }
  }
  const suffix = query.toString();
  return `${BRIDGE_URL}${path}${suffix ? `?${suffix}` : ''}`;
}

function bodyFor(req: NextApiRequest): BodyInit | undefined {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return undefined;
  if (req.body === undefined || req.body === null) return undefined;
  return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
}

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  const method = req.method ?? 'UNKNOWN';
  if (method === 'OPTIONS') {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    res.status(204).end();
    return;
  }
  if (!ALLOWED_METHODS.includes(method)) {
    return apiResponse.methodNotAllowed(res, method, ALLOWED_METHODS.filter((m) => m !== 'OPTIONS'));
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return apiResponse.unauthorized(res, 'Cortex Bridge proxy requires a per-user bearer token');
  }

  if (hasUnsafeDotSegment(req)) {
    return apiResponse.notFound(res, 'Cortex Bridge route');
  }

  const path = requestedPath(req);
  if (!hasAllowedPrefix(path)) {
    return apiResponse.notFound(res, 'Cortex Bridge route', path);
  }

  try {
    const upstream = await fetch(buildUpstreamUrl(req, path), {
      method,
      headers: {
        Authorization: auth,
        'Content-Type': req.headers['content-type'] ?? 'application/json',
        Accept: req.headers.accept ?? 'application/json',
      },
      body: bodyFor(req),
    });

    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.status(upstream.status).send(await upstream.text());
  } catch (err) {
    apiResponse.internalError(res, err instanceof Error ? err : new Error(String(err)), 'Cortex Bridge proxy failed');
  }
};

export default handler;
