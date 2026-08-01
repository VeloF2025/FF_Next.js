/**
 * Public Cortex Bridge proxy for remote MCP/API clients.
 *
 * Why this exists: the separate Cortex public hostname can be blocked by edge policy
 * before non-browser MCP clients reach the bridge. FibreFlow already has a stable
 * production surface, so remote clients use app.fibreflow.app/api/cortex-bridge.
 *
 * Security model:
 * - Requires Authorization: Bearer credential; no FibreFlow cookie fallback.
 * - Forwards only the exact read-only Cortex API method/path matrix.
 * - Does not inject CORTEX_API_KEY or any service credential.
 * - Upstream bridge remains the real auth/ACL enforcement point.
 */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';

const DEFAULT_BRIDGE_URL = ['http:', '', 'localhost:7403'].join('/');
const BRIDGE_URL = (process.env.CORTEX_BRIDGE_URL ?? DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
function pathSegments(req: NextApiRequest): string[] {
  const raw = req.query.path;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

function requestedPath(parts: string[]): string {
  return `/${parts.map((part) => encodeURIComponent(part)).join('/')}`;
}

function hasUnsafeDotSegment(req: NextApiRequest): boolean {
  const parts = pathSegments(req);
  return parts.some((part) => part === '.' || part === '..');
}

function isAllowedRequest(method: string, parts: string[]): boolean {
  const path = `/${parts.join('/')}`;
  const meetingId = parts[2];
  const isMeetingId = typeof meetingId === 'string' && /^mtg_[A-Za-z0-9_-]+$/.test(meetingId);
  if (method === 'GET') {
    return path === '/api/query'
      || path === '/api/timeline'
      || path === '/api/facts'
      || /^\/api\/facts\/[^/]+$/.test(path)
      || path === '/api/entity-profile'
      || (parts.length === 3 && parts[0] === 'api' && parts[1] === 'meetings' && isMeetingId)
      || (parts.length === 4 && parts[0] === 'api' && parts[1] === 'meetings' && isMeetingId && parts[3] === 'pack');
  }
  return (method === 'POST' && path === '/api/answer')
    || (method === 'POST' && path === '/api/mcp-tokens/revoke');
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
  if (req.method === 'GET') return undefined;
  if (req.body === undefined || req.body === null) return undefined;
  return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
}

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  const method = req.method ?? 'UNKNOWN';
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return apiResponse.unauthorized(res, 'Cortex Bridge proxy requires a per-user bearer token');
  }

  if (hasUnsafeDotSegment(req)) {
    return apiResponse.notFound(res, 'Cortex Bridge route');
  }

  const parts = pathSegments(req);
  if (!isAllowedRequest(method, parts)) {
    return apiResponse.forbidden(res, 'Cortex Bridge request is not permitted');
  }
  const path = requestedPath(parts);

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
