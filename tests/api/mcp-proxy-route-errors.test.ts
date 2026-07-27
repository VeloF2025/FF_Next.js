/**
 * Route-level tests for the MCP edge proxy, driven over a REAL http.Server.
 *
 * Two bugs shipped at this exact call site because the unit tests only exercised the
 * helpers directly:
 *   1. `req.destroy()` on cap-exceeded killed the socket shared with the response, so the
 *      413 never reached the client.
 *   2. `return pipeUpstreamResponse(...)` without `await` let a rejection escape the
 *      route's try/catch, making the `res.headersSent` guard dead code and silencing the
 *      error log.
 *
 * Neither is visible when you call the helpers in isolation — both need the handler, a
 * real socket, and a real upstream. Hence this file. Mock fidelity is the thing that
 * failed, so these tests use as little mocking as possible.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { log } = vi.hoisted(() => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ log }));

const servers: http.Server[] = [];

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));
}

afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  vi.clearAllMocks();
  delete process.env.CORTEX_REMOTE_MCP_URL;
});

/**
 * The route reads CORTEX_REMOTE_MCP_URL at MODULE LOAD, so the env var must be set
 * BEFORE importing it and the module registry reset between tests.
 *
 * Not a stylistic nicety: with a static import the default upstream (127.0.0.1:7414)
 * wins, and a real Cortex MCP service is listening there on dev machines — the first
 * version of this file was unknowingly proxying to live local infrastructure and
 * asserting against its 401.
 */
async function loadHandler(upstreamPort: number) {
  process.env.CORTEX_REMOTE_MCP_URL = `http://127.0.0.1:${upstreamPort}`;
  vi.resetModules();
  const mod = await import('@/pages/api/cortex-remote-mcp/[...path]');
  return mod.default;
}

/** Runs the real handler behind a real socket, adding the Next helpers it uses. */
async function proxyServerPointingAt(upstreamPort: number): Promise<number> {
  const handler = await loadHandler(upstreamPort);
  return listen(
    http.createServer((req, res) => {
      const nextRes = Object.assign(res, {
        status(code: number) { res.statusCode = code; return nextRes; },
        json(payload: unknown) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); return nextRes; },
        send(body: Buffer | string) { res.end(body); return nextRes; },
      });
      const nextReq = Object.assign(req, { query: { path: ['mcp'] } });
      void handler(nextReq as never, nextRes as never);
    }),
  );
}

describe('MCP proxy route — failure paths over a real socket', () => {
  it('logs and truncates when the upstream dies mid-body, instead of silently 200-ing', async () => {
    const upstreamPort = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"partial":');
        setTimeout(() => res.socket?.destroy(), 20);
      }),
    );
    const proxyPort = await proxyServerPointingAt(upstreamPort);

    let clientSawError = false;
    let body = '';
    try {
      const r = await fetch(`http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp`);
      body = await r.text();
    } catch {
      clientSawError = true;
    }

    // The client must NOT receive a complete-looking response.
    expect(clientSawError || body === '{"partial":').toBe(true);

    // And the failure must be observable. Without `return await` this never fired —
    // the rejection escaped the handler's catch entirely.
    await vi.waitFor(() => expect(log.error).toHaveBeenCalled(), { timeout: 2000 });
    expect(log.error.mock.calls[0]![0]).toMatch(/proxy failed/i);
  });

  it('delivers a real 413 to the client when the body exceeds the cap', async () => {
    // Upstream should never be reached; if the cap works the proxy answers first.
    const upstreamPort = await listen(http.createServer((_req, res) => res.end('should not be reached')));
    const proxyPort = await proxyServerPointingAt(upstreamPort);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp`, {
      method: 'POST',
      body: Buffer.alloc(6 * 1024 * 1024, 0x61), // over the 4 MiB cap
    });

    // The whole point: the caller learns WHY, rather than getting ECONNRESET.
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('passes a normal upstream response straight through', async () => {
    const upstreamPort = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"jsonrpc":"2.0","result":"ok"}');
      }),
    );
    const proxyPort = await proxyServerPointingAt(upstreamPort);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"jsonrpc":"2.0","result":"ok"}');
  });

  it('502s when the upstream is not listening at all — headers not yet sent', async () => {
    // Bind a port, learn it, then release it so nothing is listening there.
    const throwaway = http.createServer();
    const deadPort = await new Promise<number>((r) =>
      throwaway.listen(0, () => r((throwaway.address() as AddressInfo).port)),
    );
    await new Promise<void>((r) => throwaway.close(() => r()));
    const proxyPort = await proxyServerPointingAt(deadPort);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/cortex-remote-mcp/mcp`);

    // Nothing written yet, so the real 502 is reachable here.
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('BAD_GATEWAY');
  });
});
