/**
 * Edge proxy for the FibreFlow remote MCP service.
 *
 * The properties that matter here are negative ones: the proxy must fail CLOSED when
 * the localhost service is absent (a 200 would let claude.ai believe a connector is
 * live when nothing is behind it), and it must not let a crafted path escape the
 * upstream prefix. Both are asserted directly rather than by reading the code.
 */
import { Readable } from 'node:stream';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createResponse } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '@/pages/api/ff-remote-mcp/[...path]';

interface ReqOptions {
  method?: string;
  path?: string[];
  url?: string;
  body?: string;
  headers?: Record<string, string>;
}

function makeReq({ method = 'GET', path = ['mcp'], url, body = '', headers = {} }: ReqOptions = {}): NextApiRequest {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  return Object.assign(stream, {
    method,
    url: url ?? `/api/ff-remote-mcp/${path.join('/')}`,
    headers: { host: 'app.fibreflow.app', ...headers },
    query: { path },
  }) as unknown as NextApiRequest;
}

function makeRes(): NextApiResponse & { _getStatusCode(): number; _getData(): unknown } {
  return createResponse() as unknown as NextApiResponse & { _getStatusCode(): number; _getData(): unknown };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function upstreamResponse(init: { status?: number; body?: string; headers?: Record<string, string> } = {}) {
  const { status = 200, body = '{}', headers = {} } = init;
  return {
    status,
    headers: new Headers(headers),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

describe('ff-remote-mcp edge proxy', () => {
  describe('fails closed', () => {
    it('returns 502, never 200, when the localhost service is not running', async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7416'), { code: 'ECONNREFUSED' }));
      const res = makeRes();

      await handler(makeReq({ method: 'POST', body: '{"jsonrpc":"2.0"}' }), res);

      expect(res._getStatusCode()).toBe(502);
      expect(JSON.parse(String(res._getData()))).toMatchObject({ success: false, error: { code: 'BAD_GATEWAY' } });
    });
  });

  describe('path handling', () => {
    it.each([['..'], ['.'], ['a/b'], ['%2e%2e'], ['%2f']])('rejects the segment %j with 404', async (segment) => {
      const res = makeRes();

      await handler(makeReq({ path: [segment] }), res);

      expect(res._getStatusCode()).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('forwards a clean path to the localhost upstream', async () => {
      fetchMock.mockResolvedValue(upstreamResponse());
      await handler(makeReq({ path: ['mcp'] }), makeRes());

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0]![0])).toBe('http://127.0.0.1:7416/mcp');
    });

    it('preserves the query string', async () => {
      fetchMock.mockResolvedValue(upstreamResponse());
      await handler(makeReq({ path: ['authorize'], url: '/api/ff-remote-mcp/authorize?state=abc&x=1' }), makeRes());

      expect(String(fetchMock.mock.calls[0]![0])).toBe('http://127.0.0.1:7416/authorize?state=abc&x=1');
    });
  });

  describe('passthrough', () => {
    it('relays the upstream status verbatim, including the 401 that drives OAuth discovery', async () => {
      fetchMock.mockResolvedValue(
        upstreamResponse({
          status: 401,
          body: '{"error":"unauthorized"}',
          headers: { 'www-authenticate': 'Bearer resource_metadata="https://app.fibreflow.app/.well-known/x"' },
        }),
      );
      const res = makeRes();

      await handler(makeReq({ method: 'POST', body: '{}' }), res);

      expect(res._getStatusCode()).toBe(401);
      expect(res.getHeader('www-authenticate')).toContain('Bearer');
    });

    it('forwards the request body on POST', async () => {
      fetchMock.mockResolvedValue(upstreamResponse());
      await handler(makeReq({ method: 'POST', body: '{"jsonrpc":"2.0","method":"tools/list"}' }), makeRes());

      const sent = fetchMock.mock.calls[0]![1] as { body?: Buffer; method?: string };
      expect(sent.method).toBe('POST');
      expect(sent.body?.toString()).toBe('{"jsonrpc":"2.0","method":"tools/list"}');
    });

    it('sends no body on GET', async () => {
      fetchMock.mockResolvedValue(upstreamResponse());
      await handler(makeReq({ method: 'GET' }), makeRes());

      expect((fetchMock.mock.calls[0]![1] as { body?: Buffer }).body).toBeUndefined();
    });

    it('strips hop-by-hop headers in both directions', async () => {
      fetchMock.mockResolvedValue(
        upstreamResponse({ headers: { 'transfer-encoding': 'chunked', 'content-type': 'application/json' } }),
      );
      const res = makeRes();

      await handler(makeReq({ headers: { connection: 'keep-alive', 'transfer-encoding': 'chunked' } }), res);

      const forwarded = (fetchMock.mock.calls[0]![1] as { headers: Headers }).headers;
      expect(forwarded.has('connection')).toBe(false);
      expect(forwarded.has('transfer-encoding')).toBe(false);
      // host is replaced by x-forwarded-host so the upstream sees the public name.
      expect(forwarded.has('host')).toBe(false);
      expect(forwarded.get('x-forwarded-host')).toBe('app.fibreflow.app');
      expect(res.getHeader('transfer-encoding')).toBeUndefined();
      expect(res.getHeader('content-type')).toBe('application/json');
    });
  });
});
