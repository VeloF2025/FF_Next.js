import { afterEach, describe, expect, it } from 'vitest';

import {
  CALLBACK_SECRET,
  closeConsentHarnesses,
  MINTED_TOKEN,
  startCallbackServer,
  startConsentHandler,
  VALID_STATE_ID,
} from './mcpConsent.testHarness';

afterEach(closeConsentHarnesses);

describe('POST /api/cortex/mcp-consent — verified consent', () => {
  it('uses only the verified email and returns only redirectUrl', async () => {
    const mintedFor: Array<[string, '90d']> = [];
    const callback = await startCallbackServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
      }));
    });
    const app = await startConsentHandler({
      user: { id: 'user-1', email: 'lew@velocityfibre.co.za' },
      permission: { key: 'cortex.review', action: 'view', allowed: true },
      callbackBase: callback.url,
      mintToken: async (email, lifetime) => {
        mintedFor.push([email, lifetime]);
        return {
          token: MINTED_TOKEN,
          expiresAt: new Date('2026-10-28T00:00:00.000Z'),
        };
      },
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
      email: 'attacker@example.com',
      role: 'super_admin',
      token: 'browser-token',
      callback: 'https://evil.example/callback',
      redirectUrl: 'javascript:alert(1)',
    });

    expect(response.status).toBe(200);
    expect(mintedFor).toEqual([['lew@velocityfibre.co.za', '90d']]);
    expect(callback.requests).toHaveLength(1);
    expect(callback.requests[0]).toMatchObject({
      path: '/authorize/complete',
      method: 'POST',
      cortexSecret: CALLBACK_SECRET,
    });
    expect(callback.requests[0]?.json).toEqual({
      stateId: VALID_STATE_ID,
      token: MINTED_TOKEN,
    });
    expect(response.json.data).toEqual({
      redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
    });
    expect(JSON.stringify(response.json)).not.toContain(MINTED_TOKEN);
    expect(JSON.stringify(response.json)).not.toContain(CALLBACK_SECRET);
    expect(JSON.stringify(app.logs)).not.toContain(MINTED_TOKEN);
    expect(JSON.stringify(app.logs)).not.toContain(CALLBACK_SECRET);
  });

  it('honors CORTEX_REMOTE_MCP_URL with one trailing slash', async () => {
    const callback = await startCallbackServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ redirectUrl: 'https://claude.ai/callback' }));
    }, 17414);
    const app = await startConsentHandler({
      callbackBase: 'http://127.0.0.1:17414/',
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expect(response.status).toBe(200);
    expect(callback.requests).toHaveLength(1);
    expect(callback.requests[0]?.path).toBe('/authorize/complete');
  });

  it.each([
    'http://localhost/callback',
    'https://claude.ai/api/mcp/auth_callback',
  ])('accepts the safe redirect %s', async (redirectUrl) => {
    const callback = await startCallbackServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ redirectUrl }));
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expect(response.status).toBe(200);
    expect(response.json.data).toEqual({ redirectUrl });
  });

  it('builds the callback with AbortSignal.timeout(10_000)', async () => {
    const timeoutValues: number[] = [];
    const originalTimeout = AbortSignal.timeout;
    const controller = new AbortController();
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: (milliseconds: number) => {
        timeoutValues.push(milliseconds);
        return controller.signal;
      },
    });
    try {
      const callback = await startCallbackServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ redirectUrl: 'https://claude.ai/callback' }));
      });
      const app = await startConsentHandler({
        callbackBase: callback.url,
        mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      });

      const response = await app.post('/api/cortex/mcp-consent', {
        stateId: VALID_STATE_ID,
      });

      expect(response.status).toBe(200);
      expect(timeoutValues).toEqual([10_000]);
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', {
        configurable: true,
        value: originalTimeout,
      });
    }
  });
});
