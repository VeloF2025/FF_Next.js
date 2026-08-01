/** Real-loopback regression for FibreFlow MCP pre-stream failures. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';

vi.unmock('@/lib/logger');

type ProxyHandler = (request: never, response: never) => Promise<unknown>;
const servers: http.Server[] = [];

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  delete process.env.FF_REMOTE_MCP_URL;
  await Promise.all(servers.splice(0).map(closeServer));
  vi.resetModules();
});

async function proxyPort(upstreamPort: number): Promise<number> {
  process.env.FF_REMOTE_MCP_URL = `http://127.0.0.1:${upstreamPort}`;
  vi.resetModules();
  const handler = (await import('@/pages/api/ff-remote-mcp/[...path]')).default;
  return listen(http.createServer((req, res) => {
    const nextRes = Object.assign(res, {
      status(code: number) { res.statusCode = code; return nextRes; },
      json(body: unknown) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); return nextRes; },
      send(body: Buffer | string) { res.end(body); return nextRes; },
    });
    const nextReq = Object.assign(req, { query: { path: ['mcp'] } });
    void (handler as ProxyHandler)(nextReq as never, nextRes as never);
  }));
}

it('removes upstream headers from a generic pre-body 502', async () => {
  const upstreamPort = await listen(http.createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/plain',
      'set-cookie': 'upstream_session=must-not-survive',
      'www-authenticate': 'Bearer realm="upstream"',
      'x-upstream-sentinel': 'must-not-survive',
    });
    res.flushHeaders();
    setTimeout(() => res.socket?.destroy(), 20);
  }));
  const port = await proxyPort(upstreamPort);

  const response = await fetch(`http://127.0.0.1:${port}/api/ff-remote-mcp/mcp`);

  expect(response.status).toBe(502);
  expect((await response.json()).error.code).toBe('BAD_GATEWAY');
  for (const header of ['set-cookie', 'www-authenticate', 'x-upstream-sentinel']) {
    expect(response.headers.has(header), header).toBe(false);
  }
});
