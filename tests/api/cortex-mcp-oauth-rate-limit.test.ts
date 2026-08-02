/**
 * Real-socket proof for the public Cortex OAuth edge limits.
 *
 * Production regressions caught here:
 * - trusting X-Forwarded-For lets callers rotate the first value and evade a bucket;
 * - including query/state in the key creates one bucket per authorization attempt;
 * - checking after body parsing/upstream fetch lets rejected registrations consume work;
 * - sharing one bucket across methods or OAuth endpoints throttles token/MCP traffic.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/logger');
vi.unmock('@/lib/rateLimiter');

import { log } from '@/lib/logger';
import rateLimiter from '@/lib/rateLimiter';

type ProxyHandler = (request: never, response: never) => Promise<unknown>;

interface HttpResult {
  body: string;
  headers: http.IncomingHttpHeaders;
  status: number;
}

const servers: http.Server[] = [];
const upstreamCounts = new Map<string, number>();
let proxyPort = 0;

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function requestPath(rawUrl: string | undefined): string[] {
  const pathname = new URL(rawUrl || '/', 'http://localhost').pathname;
  const prefix = '/api/cortex-remote-mcp/';
  return pathname.startsWith(prefix)
    ? pathname.slice(prefix.length).split('/').filter(Boolean)
    : [];
}

function nextServer(handler: ProxyHandler): http.Server {
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
    const nextReq = Object.assign(req, { query: { path: requestPath(req.url) } });
    void handler(nextReq as never, nextRes as never);
  });
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function request(
  path: string,
  init: { body?: string; headers?: Record<string, string>; method?: string } = {},
): Promise<HttpResult> {
  const response = await fetch(`http://127.0.0.1:${proxyPort}${path}`, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  return {
    body: await response.text(),
    headers: Object.fromEntries(response.headers.entries()),
    status: response.status,
  };
}

function unfinishedRequest(path: string, headers: Record<string, string>): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      path,
      method: 'POST',
      headers: { ...headers, 'content-length': '200' },
    });
    const deadline = setTimeout(() => {
      req.destroy();
      reject(new Error('proxy waited for the unfinished body before rate limiting'));
    }, 1000);
    req.on('error', reject);
    req.on('response', (res) => {
      clearTimeout(deadline);
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ body, headers: res.headers, status: res.statusCode || 0 });
        req.destroy();
      });
    });
    req.write('{"client_secret":"body-secret-never-finished"');
  });
}

beforeAll(async () => {
  const upstreamPort = await listen(http.createServer((req, res) => {
    const key = `${req.method} ${new URL(req.url || '/', 'http://localhost').pathname}`;
    upstreamCounts.set(key, (upstreamCounts.get(key) || 0) + 1);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"upstream":true}');
    });
  }));
  process.env.CORTEX_REMOTE_MCP_URL = `http://127.0.0.1:${upstreamPort}`;
  const handler = (await import('@/pages/api/cortex-remote-mcp/[...path]')).default;
  proxyPort = await listen(nextServer(handler as ProxyHandler));
});

beforeEach(() => {
  upstreamCounts.clear();
  log.clearLogs();
});

afterAll(async () => {
  delete process.env.CORTEX_REMOTE_MCP_URL;
  for (const key of [
    'cortex-oauth-register:198.51.100.31',
    'cortex-oauth-register:198.51.100.32',
    'cortex-oauth-register:198.51.100.40',
    'cortex-oauth-authorize:198.51.100.40',
    'cortex-oauth-authorize:127.0.0.1',
    'cortex-oauth-authorize:::ffff:127.0.0.1',
    // Socket-fallback buckets used by the malformed-X-Real-IP case.
    'cortex-oauth-register:127.0.0.1',
    'cortex-oauth-register:::ffff:127.0.0.1',
  ]) {
    rateLimiter.reset(key);
  }
  log.clearLogs();
  await Promise.all(servers.splice(0).map(closeServer));
});

describe('Cortex public OAuth rate limits over real HTTP', () => {
  it('rejects the 31st registration before reading its body or forwarding it', async () => {
    const ip = '198.51.100.31';
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const result = await request(`/api/cortex-remote-mcp/register?state=state-${attempt}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${attempt}, 192.0.2.1`,
          'x-real-ip': ip,
        },
        body: `{"redirect_uris":["https://client.invalid/callback/${attempt}"]}`,
      });
      expect(result.status).toBe(200);
    }

    const blocked = await unfinishedRequest(
      '/api/cortex-remote-mcp/register?state=state-secret-31&code=code-secret-31',
      { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.200', 'x-real-ip': ip },
    );

    expect(blocked.status).toBe(429);
    expect(JSON.parse(blocked.body)).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many OAuth requests' },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(upstreamCounts.get('POST /register')).toBe(30);

    const independent = await request('/api/cortex-remote-mcp/register?state=other-ip', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.32' },
      body: '{}',
    });
    expect(independent.status).toBe(200);
    expect(upstreamCounts.get('POST /register')).toBe(31);

    const logs = log.exportLogs();
    expect(logs).toContain('cortex-oauth-register');
    expect(logs).toContain(ip);
    for (const secret of ['state-secret-31', 'code-secret-31', 'body-secret-never-finished']) {
      expect(logs).not.toContain(secret);
    }
  });

  it('uses the socket when X-Real-IP is absent and ignores XFF/query changes', async () => {
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      const result = await request(
        `/api/cortex-remote-mcp/authorize?state=authorize-${attempt}&code=code-${attempt}`,
        { headers: { 'x-forwarded-for': `198.51.100.${attempt}, 192.0.2.9` } },
      );
      expect(result.status).toBe(200);
    }

    const blocked = await request(
      '/api/cortex-remote-mcp/authorize?state=authorize-secret-61&code=code-secret-61',
      { headers: { 'x-forwarded-for': '203.0.113.250' } },
    );

    expect(blocked.status).toBe(429);
    expect(JSON.parse(blocked.body)).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many OAuth requests' },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(upstreamCounts.get('GET /authorize')).toBe(60);

    const logs = log.exportLogs();
    expect(logs).toContain('cortex-oauth-authorize');
    expect(logs).not.toContain('authorize-secret-61');
    expect(logs).not.toContain('code-secret-61');
  });

  it('falls back to the socket when X-Real-IP is malformed, so it cannot be used to pick a bucket', async () => {
    // The whole point of validating X-Real-IP with isIP() is that the header is
    // caller-controllable. Without that check a caller supplies a fresh bogus value per
    // request, every one becomes its own bucket key, and the limit never fires — the same
    // evasion XFF rotation gives. Each request below carries a DIFFERENT malformed header,
    // including a comma-joined list; all must collapse onto the one socket bucket.
    const malformed = [
      'not-an-ip',
      '1.2.3.4, 5.6.7.8',
      '999.999.999.999',
      '',
      '   ',
      '127.0.0.1:8080',
      '<script>',
      'localhost',
    ];
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const result = await request(`/api/cortex-remote-mcp/register?state=spoof-${attempt}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-real-ip': malformed[attempt % malformed.length],
        },
        body: '{}',
      });
      expect(result.status).toBe(200);
    }

    const blocked = await request('/api/cortex-remote-mcp/register?state=spoof-secret-31', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': 'yet-another-bogus-value' },
      body: '{}',
    });

    expect(blocked.status).toBe(429);
    expect(JSON.parse(blocked.body)).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many OAuth requests' },
    });

    const logs = log.exportLogs();
    // The bogus header value must not be echoed into the log as if it were an address.
    expect(logs).not.toContain('yet-another-bogus-value');
    expect(logs).not.toContain('spoof-secret-31');
  });

  it('does not apply OAuth buckets to other methods or token and MCP routes', async () => {
    const ip = '198.51.100.40';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await request('/api/cortex-remote-mcp/register', {
        method: 'POST',
        headers: { 'x-real-ip': ip },
        body: '{}',
      });
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await request('/api/cortex-remote-mcp/authorize', { headers: { 'x-real-ip': ip } });
    }
    expect((await request('/api/cortex-remote-mcp/register', {
      method: 'POST',
      headers: { 'x-real-ip': ip },
      body: '{}',
    })).status).toBe(429);
    expect((await request('/api/cortex-remote-mcp/authorize', {
      headers: { 'x-real-ip': ip },
    })).status).toBe(429);

    const results = await Promise.all([
      request('/api/cortex-remote-mcp/register', { headers: { 'x-real-ip': ip } }),
      request('/api/cortex-remote-mcp/authorize', { method: 'POST', headers: { 'x-real-ip': ip }, body: '{}' }),
      request('/api/cortex-remote-mcp/token', { method: 'POST', headers: { 'x-real-ip': ip }, body: '{}' }),
      request('/api/cortex-remote-mcp/mcp', { method: 'POST', headers: { 'x-real-ip': ip }, body: '{}' }),
    ]);

    expect(results.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    expect(upstreamCounts.get('POST /register')).toBe(30);
    expect(upstreamCounts.get('GET /authorize')).toBe(60);
    expect(upstreamCounts.get('GET /register')).toBe(1);
    expect(upstreamCounts.get('POST /authorize')).toBe(1);
    expect(upstreamCounts.get('POST /token')).toBe(1);
    expect(upstreamCounts.get('POST /mcp')).toBe(1);
  });

  it('expires real limiter entries after their window', async () => {
    const key = 'cortex-oauth-expiry-proof:198.51.100.250';
    expect(rateLimiter.check(key, 1, 5).success).toBe(true);
    expect(rateLimiter.check(key, 1, 5).success).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(rateLimiter.check(key, 1, 5).success).toBe(true);
    rateLimiter.reset(key);
  });
});
