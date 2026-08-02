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

/** A port that was bound then released, so connecting to it fails before any byte moves. */
async function deadUpstreamPort(): Promise<number> {
  const server = http.createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

it('leaks neither the upstream error nor the OAuth query on a pre-stream 502', async () => {
  // This route is deliberately unauthenticated and fronts an OAuth 2.1 server, so anything
  // it echoes goes to anyone on the internet and anything it logs is a live OAuth
  // parameter. It previously did both: `detail: error.message` in the body, and
  // `{ upstreamUrl, error }` in the log while its twin cortex-remote-mcp suppressed both.
  const chunks: string[] = [];
  const realWrite = process.stdout.write;
  process.stdout.write = function capture(chunk: Uint8Array | string, ...args: unknown[]) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return realWrite.call(process.stdout, chunk, ...args as []);
  } as typeof process.stdout.write;

  let response: Response;
  try {
    const port = await proxyPort(await deadUpstreamPort());
    response = await fetch(
      `http://127.0.0.1:${port}/api/ff-remote-mcp/authorize`
        + '?state=oauth-state-secret&code=oauth-code-secret&client_id=oauth-client-secret',
    );
  } finally {
    process.stdout.write = realWrite;
  }

  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body.error.code).toBe('BAD_GATEWAY');
  expect(body.error, 'the 502 must not echo the upstream error message').not.toHaveProperty('detail');

  const secrets = ['oauth-state-secret', 'oauth-code-secret', 'oauth-client-secret'];
  const serializedBody = JSON.stringify(body);
  const logged = chunks.join('');
  for (const secret of secrets) {
    expect(serializedBody, `response body leaked ${secret}`).not.toContain(secret);
    expect(logged, `log leaked ${secret}`).not.toContain(secret);
  }
});

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
