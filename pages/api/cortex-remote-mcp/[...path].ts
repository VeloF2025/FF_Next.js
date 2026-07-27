import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { BODY_TOO_LARGE, MAX_PROXY_BODY_BYTES, pipeUpstreamResponse, readCappedBody } from '@/lib/mcp/proxyStream';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const DEFAULT_UPSTREAM = ['http:', '', '127.0.0.1:7414'].join('/');
const UPSTREAM = (process.env.CORTEX_REMOTE_MCP_URL || DEFAULT_UPSTREAM).replace(/\/$/, '');

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

function pathFromQuery(req: NextApiRequest): string {
  const raw = req.query.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const segment of parts) {
    const decoded = decodeURIComponent(segment);
    if (decoded === '.' || decoded === '..' || decoded.includes('/')) {
      throw new Error('invalid path segment');
    }
  }
  return '/' + parts.map((segment) => encodeURIComponent(segment)).join('/');
}

function forwardHeaders(req: NextApiRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'host') continue;
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (typeof value === 'string') headers.set(key, value);
  }
  headers.set('x-forwarded-host', typeof req.headers.host === 'string' ? req.headers.host : 'app.fibreflow.app');
  headers.set('x-forwarded-proto', 'https');
  return headers;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let targetPath: string;
  try {
    targetPath = pathFromQuery(req);
  } catch (error) {
    log.warn('Rejected invalid Cortex remote MCP path', { path: req.query.path, error });
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invalid MCP path' } });
  }

  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstreamUrl = `${UPSTREAM}${targetPath}${query}`;

  try {
    const rawBody = await readCappedBody(req);
    if (rawBody === BODY_TOO_LARGE) {
      log.warn('Cortex remote MCP request body over cap', { upstreamUrl, maxBytes: MAX_PROXY_BODY_BYTES });
      return res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the proxy limit' },
      });
    }

    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: forwardHeaders(req),
      body: rawBody ? (rawBody as unknown as BodyInit) : undefined,
      redirect: 'manual',
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
    });

    // `return await`, not `return`. A bare `return <promise>` inside try/catch leaves the
    // try scope before the promise settles, so a later rejection escapes THIS catch and
    // becomes the handler's own rejection — the headersSent guard below would be dead
    // code and the failure would never be logged. Verified by execution: without await,
    // the catch does not run.
    return await pipeUpstreamResponse(upstream, res);
  } catch (error) {
    log.error('Cortex remote MCP proxy failed', { upstreamUrl, error });

    // Streaming the response introduced a failure mode buffering did not have: once the
    // upstream's status and first bytes are on the wire, res.status(502) throws
    // ERR_HTTP_HEADERS_SENT (verified against a real server). Destroying the socket is
    // the only honest signal left — it tells the client the body is TRUNCATED, rather
    // than letting a partial response look complete.
    if (res.headersSent) {
      res.destroy();
      return;
    }

    return res.status(502).json({
      success: false,
      error: {
        code: 'BAD_GATEWAY',
        message: 'Cortex remote MCP service is unavailable',
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
