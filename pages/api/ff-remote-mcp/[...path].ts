/**
 * Edge proxy for the FibreFlow remote MCP service.
 *
 * The service binds 127.0.0.1 only; this route is its sole public path, so that
 * claude.ai can reach https://app.fibreflow.app/api/ff-remote-mcp/mcp as a custom
 * connector. Deliberately unauthenticated at this layer — the MCP service runs the
 * OAuth 2.1 authorization server and answers 401 with the WWW-Authenticate challenge
 * that drives discovery.
 *
 * Path handling and header stripping are taken unchanged from
 * pages/api/cortex-remote-mcp/[...path].ts (PR #2059, in production since 2026-06) —
 * that logic is reviewed and load-bearing.
 *
 * Body/response bounds are NOT copied: both proxies now share src/lib/mcp/proxyStream.ts.
 * The original buffered both directions in full, and cloning it verbatim reproduced a
 * live DoS (see PR #2262). "Byte-identical to a reviewed production file" is not a safety
 * argument — it doubles whatever that file already has wrong.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { applyOAuthRateLimit } from '@/lib/mcp/oauthRateLimit';
import { BODY_TOO_LARGE, MAX_PROXY_BODY_BYTES, pipeUpstreamResponse, readCappedBody } from '@/lib/mcp/proxyStream';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const DEFAULT_UPSTREAM = ['http:', '', '127.0.0.1:7416'].join('/');
const UPSTREAM = (process.env.FF_REMOTE_MCP_URL || DEFAULT_UPSTREAM).replace(/\/$/, '');
/** Bucket namespace for this proxy's OAuth limiter; keeps it separate from cortex-remote-mcp. */
const OAUTH_BUCKET_PREFIX = 'ff';

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
  } catch {
    // Nothing request-derived is logged here. This route serves the OAuth 2.1 flow, so the
    // path and query carry `state`, `code`, `redirect_uri` and friends — see the redaction
    // contract in tests/middleware-cortex-query-redaction.test.ts.
    log.warn('Rejected invalid FibreFlow remote MCP path');
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invalid MCP path' } });
  }

  if (!applyOAuthRateLimit(req, res, targetPath, OAUTH_BUCKET_PREFIX)) return;

  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstreamUrl = `${UPSTREAM}${targetPath}${query}`;

  try {
    const rawBody = await readCappedBody(req);
    if (rawBody === BODY_TOO_LARGE) {
      // `upstreamUrl` embeds the caller's query string — never log it.
      log.warn('FibreFlow remote MCP request body over cap', { maxBytes: MAX_PROXY_BODY_BYTES });
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

    // `return await`, not `return`. A bare `return <promise>` leaves the try scope before
    // the promise settles, so a later rejection escapes THIS catch — the headersSent
    // guard becomes dead code and the failure is never logged. See PR #2262.
    return await pipeUpstreamResponse(upstream, res);
  } catch {
    // Neither `upstreamUrl` (which embeds the OAuth query string) nor the error object
    // (whose message can quote the failing URL) may be logged. `phase` is enough to tell
    // an upstream-connect failure from a mid-stream one.
    log.error('FibreFlow remote MCP proxy failed', {
      phase: res.headersSent ? 'stream' : 'upstream',
    });

    // Streaming can fail AFTER the upstream status and first bytes are on the wire, and
    // res.status(502) then throws ERR_HTTP_HEADERS_SENT. Destroying is the only honest
    // signal left: it marks the body TRUNCATED rather than letting a partial response
    // look complete.
    if (res.headersSent) {
      res.destroy();
      return;
    }

    // Fetch headers are copied before streaming starts. If the body then fails before
    // its first byte, none of those upstream headers belong on our generic 502.
    for (const header of res.getHeaderNames()) res.removeHeader(header);
    // No `detail`: this route is unauthenticated, so an error message echoed here goes to
    // anyone on the internet. Every other route reaches apiResponse.internalError, which
    // withholds details outside development; this one hand-rolls its 502 and must do the
    // same by construction.
    return res.status(502).json({
      success: false,
      error: {
        code: 'BAD_GATEWAY',
        message: 'FibreFlow remote MCP service is unavailable',
      },
    });
  }
}
