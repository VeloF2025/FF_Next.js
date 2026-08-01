/** Real-socket contracts for the public Cortex MCP edge proxy. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/logger');

import { log } from '@/lib/logger';

type ProxyHandler = (request: never, response: never) => Promise<unknown>;

interface HttpResult {
  body: string;
  headers: http.IncomingHttpHeaders;
  status: number;
}

const servers: http.Server[] = [];
const handlerCompletions: Promise<unknown>[] = [];
function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}
async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  delete process.env.CORTEX_REMOTE_MCP_URL;
  delete process.env.CORTEX_REMOTE_MCP_TIMEOUT_MS;
  log.clearLogs();
  handlerCompletions.length = 0;
  await Promise.all(servers.splice(0).map(closeServer));
  vi.resetModules();
});

async function loadRoute(upstreamPort: number, timeout = '100') {
  process.env.CORTEX_REMOTE_MCP_URL = `http://127.0.0.1:${upstreamPort}`;
  process.env.CORTEX_REMOTE_MCP_TIMEOUT_MS = timeout;
  vi.resetModules();
  return import('@/pages/api/cortex-remote-mcp/[...path]');
}

function nextServer(handler: ProxyHandler, path: string[] = ['mcp']): http.Server {
  return http.createServer((req, res) => {
    const nextRes = Object.assign(res, {
      json(payload: unknown) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
        return nextRes;
      },
      send(body: Buffer | string) {
        res.end(body);
        return nextRes;
      },
      status(code: number) {
        res.statusCode = code;
        return nextRes;
      },
    });
    const nextReq = Object.assign(req, { query: { path } });
    const completion = handler(nextReq as never, nextRes as never);
    handlerCompletions.push(completion);
    void completion.catch(() => undefined);
  });
}

async function proxyServerPointingAt(
  upstreamPort: number,
  timeout = '100',
  path: string[] = ['mcp'],
): Promise<number> {
  const route = await loadRoute(upstreamPort, timeout);
  return listen(nextServer(route.default as ProxyHandler, path));
}

async function request(path: string, init: RequestInit = {}): Promise<HttpResult> {
  const response = await fetch(path, init);
  return {
    body: await response.text(),
    headers: Object.fromEntries(response.headers.entries()),
    status: response.status,
  };
}

function expectGeneric502(result: HttpResult): void {
  expect(result.status).toBe(502);
  expect(JSON.parse(result.body)).toEqual({
    success: false,
    error: {
      code: 'BAD_GATEWAY',
      message: 'Cortex remote MCP service is unavailable',
    },
  });
}

function failureLog() {
  return log.getLogs().find((entry) => entry.message === 'Cortex remote MCP proxy failed');
}

describe('MCP proxy route over real sockets', () => {
  it('bounds and defensively parses the upstream timeout override', async () => {
    const upstreamPort = await listen(http.createServer((_req, res) => res.end('ok')));
    const route = (await loadRoute(upstreamPort)) as unknown as {
      parseUpstreamTimeoutMs(raw: string | undefined): number;
    };

    expect(route.parseUpstreamTimeoutMs('250')).toBe(250);
    expect(route.parseUpstreamTimeoutMs('1')).toBe(25);
    expect(route.parseUpstreamTimeoutMs('999999')).toBe(120_000);
    for (const malformed of [undefined, '', '0', '-1', '12.5', 'not-a-number']) {
      expect(route.parseUpstreamTimeoutMs(malformed)).toBe(30_000);
    }
  });

  it('returns a generic 502 within the configured deadline when upstream stalls', async () => {
    const upstreamPort = await listen(http.createServer((req) => req.resume()));
    const proxyPort = await proxyServerPointingAt(upstreamPort, '50');
    log.clearLogs();
    const started = Date.now();

    const result = await request(
      `http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp?state=stall-secret`,
      { signal: AbortSignal.timeout(1_000) },
    );

    expectGeneric502(result);
    expect(Date.now() - started).toBeLessThan(900);
    expect(failureLog()?.data).toEqual({ phase: 'upstream' });
    expect(log.exportLogs()).not.toContain('stall-secret');
  });

  it('returns a redacted 502 when the upstream is not listening', async () => {
    const throwaway = http.createServer();
    const deadPort = await new Promise<number>((resolve) => {
      throwaway.listen(0, '127.0.0.1', () => {
        resolve((throwaway.address() as AddressInfo).port);
      });
    });
    await new Promise<void>((resolve) => throwaway.close(() => resolve()));
    const proxyPort = await proxyServerPointingAt(deadPort);
    log.clearLogs();

    const result = await request(
      `http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp?state=dead-secret&code=dead-code`,
    );

    expectGeneric502(result);
    expect(failureLog()?.data).toEqual({ phase: 'upstream' });
    expect(log.exportLogs()).not.toMatch(/dead-secret|dead-code/);
  });

  it('delivers a generic 413 without logging the request query or body', async () => {
    const upstreamPort = await listen(
      http.createServer((_req, res) => res.end('should not be reached')),
    );
    const proxyPort = await proxyServerPointingAt(upstreamPort);
    log.clearLogs();

    const result = await request(
      `http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp?state=cap-secret`,
      { method: 'POST', body: Buffer.alloc(6 * 1024 * 1024, 0x61) },
    );

    expect(result.status).toBe(413);
    expect(JSON.parse(result.body)).toEqual({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the proxy limit',
      },
    });
    const warning = log.getLogs().find(
      (entry) => entry.message === 'Cortex remote MCP request body over cap',
    );
    expect(warning?.data).toEqual({ maxBytes: 4 * 1024 * 1024 });
    expect(log.exportLogs()).not.toContain('cap-secret');
  });

  it('returns a generic 502 when upstream fails after headers but before any body byte', async () => {
    const upstreamPort = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'x-upstream-sentinel': 'must-not-survive',
          location: '/upstream-only',
          'www-authenticate': 'Bearer realm="upstream"',
        });
        res.flushHeaders();
        setTimeout(() => res.socket?.destroy(), 20);
      }),
    );
    const proxyPort = await proxyServerPointingAt(upstreamPort);
    log.clearLogs();
    const result = await request(
      `http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp?state=zero-byte-secret`,
    );
    expectGeneric502(result);
    expect(result.headers).not.toHaveProperty('x-upstream-sentinel');
    expect(result.headers).not.toHaveProperty('location');
    expect(result.headers).not.toHaveProperty('www-authenticate');
    expect(failureLog()?.data).toEqual({ phase: 'upstream' });
    expect(log.exportLogs()).not.toContain('zero-byte-secret');
  });

  it('closes the downstream socket when the upstream dies after streaming starts', async () => {
    const upstreamPort = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"partial":');
        setTimeout(() => res.socket?.destroy(), 20);
      }),
    );
    const proxyPort = await proxyServerPointingAt(upstreamPort);
    log.clearLogs();

    const result = await new Promise<{ aborted: boolean; body: string }>((resolve, reject) => {
      http.get(
        `http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp?code=stream-secret`,
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('aborted', () => resolve({ aborted: true, body }));
          res.on('end', () => resolve({ aborted: false, body }));
          res.on('error', () => resolve({ aborted: true, body }));
        },
      ).on('error', reject);
    });

    expect(result).toEqual({ aborted: true, body: '{"partial":' });
    await vi.waitFor(() => expect(failureLog()).toBeDefined());
    expect(await Promise.allSettled(handlerCompletions)).toEqual([
      expect.objectContaining({ status: 'fulfilled' }),
    ]);
    expect(failureLog()?.data).toEqual({ phase: 'stream' });
    expect(log.exportLogs()).not.toContain('stream-secret');
  });

  it('does not expose an invalid path or query in its warning', async () => {
    const upstreamPort = await listen(http.createServer((_req, res) => res.end('unused')));
    const proxyPort = await proxyServerPointingAt(upstreamPort, '100', ['..']);
    log.clearLogs();

    const result = await request(
      `http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/invalid?state=path-secret`,
    );

    expect(result.status).toBe(404);
    const warning = log.getLogs().find(
      (entry) => entry.message === 'Rejected invalid Cortex remote MCP path',
    );
    expect(warning?.data).toBeUndefined();
    expect(log.exportLogs()).not.toContain('path-secret');
  });

  it('streams a normal upstream status, header, and body unchanged', async () => {
    const upstreamPort = await listen(
      http.createServer((_req, res) => {
        res.writeHead(201, {
          'content-type': 'application/json',
          'x-cortex-proof': 'streamed',
        });
        res.end('{"jsonrpc":"2.0","result":"ok"}');
      }),
    );
    const proxyPort = await proxyServerPointingAt(upstreamPort);

    const result = await request(`http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp`);

    expect(result.status).toBe(201);
    expect(result.headers['x-cortex-proof']).toBe('streamed');
    expect(result.body).toBe('{"jsonrpc":"2.0","result":"ok"}');
  });

  it('preserves upstream redirects without following them', async () => {
    const upstreamPort = await listen(
      http.createServer((_req, res) => {
        res.writeHead(302, { location: '/consent?state=redirect-proof' });
        res.end();
      }),
    );
    const proxyPort = await proxyServerPointingAt(upstreamPort);

    const result = await request(
      `http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/authorize`,
      { redirect: 'manual' },
    );

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/consent?state=redirect-proof');
  });
});
