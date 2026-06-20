import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../[...path]';

const fetchMock = vi.fn();
const bridgeBase = ['http:', '', 'localhost:7403'].join('/');

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CORTEX_BRIDGE_URL;
});

function run(options: Parameters<typeof createMocks<NextApiRequest, NextApiResponse>>[0]) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>(options);
  return { req, res, done: handler(req, res) };
}

describe('/api/cortex-bridge/[...path]', () => {
  it('401s without a bearer token and does not call the bridge', async () => {
    const { res, done } = run({ method: 'GET', query: { path: ['api', 'query'], q: 'Benfarm' } });
    await done;
    expect(res._getStatusCode()).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s for non-whitelisted bridge paths', async () => {
    const { res, done } = run({
      method: 'GET',
      headers: { authorization: 'Bearer user-token' },
      query: { path: ['admin', 'debug'] },
    });
    await done;
    expect(res._getStatusCode()).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });



  it('rejects decoded dot segments before URL normalization can escape the whitelist', async () => {
    const { res, done } = run({
      method: 'GET',
      headers: { authorization: 'Bearer user-token' },
      query: { path: ['api', 'query', '..', 'admin', 'debug'] },
    });
    await done;
    expect(res._getStatusCode()).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies allowed GET requests with bearer auth and query params intact', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const { res, done } = run({
      method: 'GET',
      headers: { authorization: 'Bearer user-token', accept: 'application/json' },
      query: { path: ['api', 'query'], q: 'Benfarm', limit: '5' },
    });
    await done;
    expect(res._getStatusCode()).toBe(200);
    expect(res._getData()).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledWith(`${bridgeBase}/api/query?q=Benfarm&limit=5`, expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer user-token' }),
      body: undefined,
    }));
  });

  it('proxies allowed POST JSON bodies without injecting service credentials', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"answer":"done"}', { status: 200 }));
    const { res, done } = run({
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      query: { path: ['api', 'answer'] },
      body: { question: 'What changed?' },
    });
    await done;
    expect(res._getStatusCode()).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ question: 'What changed?' }));
    expect(init.headers.Authorization).toBe('Bearer user-token');
    expect(init.headers['X-Cortex-Channel-Key']).toBeUndefined();
  });
});
