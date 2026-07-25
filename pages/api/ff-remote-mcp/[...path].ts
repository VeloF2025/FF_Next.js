/**
 * Edge proxy for the FibreFlow remote MCP service.
 *
 * The service binds 127.0.0.1 only; this route is its sole public path, so that
 * claude.ai can reach https://app.fibreflow.app/api/ff-remote-mcp/mcp as a custom
 * connector. Deliberately unauthenticated at this layer — the MCP service runs the
 * OAuth 2.1 authorization server and answers 401 with the WWW-Authenticate challenge
 * that drives discovery.
 *
 * Cloned from pages/api/cortex-remote-mcp/[...path].ts (PR #2059, in production since
 * 2026-06). Only the upstream port and env var differ; the path handling and header
 * stripping are unchanged on purpose — that file has been reviewed and is load-bearing.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const DEFAULT_UPSTREAM = ['http:', '', '127.0.0.1:7416'].join('/');
const UPSTREAM = (process.env.FF_REMOTE_MCP_URL || DEFAULT_UPSTREAM).replace(/\/$/, '');

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

async function readRawBody(req: NextApiRequest): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
    log.warn('Rejected invalid FibreFlow remote MCP path', { path: req.query.path, error });
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invalid MCP path' } });
  }

  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstreamUrl = `${UPSTREAM}${targetPath}${query}`;

  try {
    const rawBody = await readRawBody(req);
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

    const body = Buffer.from(await upstream.arrayBuffer());
    return res.send(body);
  } catch (error) {
    log.error('FibreFlow remote MCP proxy failed', { upstreamUrl, error });
    return res.status(502).json({
      success: false,
      error: {
        code: 'BAD_GATEWAY',
        message: 'FibreFlow remote MCP service is unavailable',
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
