import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CALLBACK_SECRET,
  closeConsentHarnesses,
  MINTED_TOKEN,
  startCallbackServer,
  startConsentHandler,
  VALID_STATE_ID,
} from './mcpConsent.testHarness';

const GATEWAY_MESSAGE =
  'Authorization could not be completed. Return to Claude and try connecting again.';

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
    });
    const app = await startConsentHandler({
      callbackBase: `${callback.url}/`,
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

  it('does not forward the secret or bearer across an upstream redirect', async () => {
    const redirectedOrigin = await startCallbackServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ redirectUrl: 'https://claude.ai/callback' }));
    });
    const callback = await startCallbackServer((_request, response) => {
      response.writeHead(307, {
        location: `${redirectedOrigin.url}/stolen`,
      });
      response.end();
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expect(callback.requests).toHaveLength(1);
    expect(redirectedOrigin.requests).toEqual([]);
    expect(response.status).toBe(502);
    expect(response.json).toMatchObject({
      success: false,
      error: {
        code: 'BAD_GATEWAY',
        message: GATEWAY_MESSAGE,
      },
    });
    expect(JSON.stringify(response.json)).not.toContain(MINTED_TOKEN);
    expect(JSON.stringify(response.json)).not.toContain(CALLBACK_SECRET);
  });

  it('does not log sensitive malformed callback JSON', async () => {
    const sensitiveBearer = 'b3ar';
    const sensitiveSecret = 's3cr';
    const callback = await startCallbackServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${sensitiveBearer}${sensitiveSecret}`);
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      callbackSecret: sensitiveSecret,
      mintToken: async () => ({ token: sensitiveBearer, expiresAt: null }),
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expect(response.status).toBe(502);
    expect(response.json.error).toEqual({
      code: 'BAD_GATEWAY',
      message: GATEWAY_MESSAGE,
    });
    expect(JSON.stringify(response.json)).not.toContain(sensitiveBearer);
    expect(JSON.stringify(response.json)).not.toContain(sensitiveSecret);
    expect(JSON.stringify(app.logs)).not.toContain(sensitiveBearer);
    expect(JSON.stringify(app.logs)).not.toContain(sensitiveSecret);
  });
});

describe('POST /api/cortex/mcp-consent — the FibreFlow API grant', () => {
  // Generated rather than a literal: the secret scanner treats a token-shaped string
  // constant as a credential, and it is right to — a fixed one here would train people
  // to write them elsewhere. Random also proves the assertions match the VALUE passed
  // through, not a string that happens to appear in both places.
  const FF_TOKEN = `ff_${randomBytes(24).toString('hex')}`;

  function okCallback() {
    return startCallbackServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
      }));
    });
  }

  it('sends NO ffToken when the grant is off', async () => {
    // The default. Every existing connection must keep the narrower grant it was
    // authorised under, so the key is absent rather than null.
    let minted = false;
    const callback = await okCallback();
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      mintFfToken: (async () => { minted = true; return { token: FF_TOKEN }; }) as never,
      env: {},
    });

    await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(minted).toBe(false);
    const body = callback.requests[0]!.json as Record<string, unknown>;
    expect('ffToken' in body).toBe(false);
  });

  it('sends the ffToken when the grant is on', async () => {
    // The mirror: without it, a handler that never minted would satisfy the case above.
    const callback = await okCallback();
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      mintFfToken: (async () => ({ token: FF_TOKEN })) as never,
      env: { CORTEX_FF_API_ENABLED: 'true' },
    });

    await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    const body = callback.requests[0]!.json as Record<string, unknown>;
    expect(body.ffToken).toBe(FF_TOKEN);
  });

  it('mints for the VERIFIED user, never a client-supplied identity', async () => {
    const seen: Array<{ email: string; lifetime: string }> = [];
    const callback = await okCallback();
    const app = await startConsentHandler({
      user: { id: 'user-1', email: 'lew@velocityfibre.co.za' },
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      mintFfToken: (async (user: { email: string }, lifetime: string) => {
        seen.push({ email: user.email, lifetime });
        return { token: FF_TOKEN };
      }) as never,
      env: { CORTEX_FF_API_ENABLED: 'true' },
    });

    await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
      email: 'attacker@example.com',
      role: 'super_admin',
    });

    expect(seen).toEqual([{ email: 'lew@velocityfibre.co.za', lifetime: '90d' }]);
  });

  it('never returns the ffToken to the browser', async () => {
    // It is a FibreFlow bearer. The browser gets a redirect URL and nothing else — the
    // same rule the bridge token already follows.
    const callback = await okCallback();
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      mintFfToken: (async () => ({ token: FF_TOKEN })) as never,
      env: { CORTEX_FF_API_ENABLED: 'true' },
    });

    const response = await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(JSON.stringify(response.json)).not.toContain(FF_TOKEN);
    expect(JSON.stringify(app.logs)).not.toContain(FF_TOKEN);
  });
});

describe('POST /api/cortex/mcp-consent — the grant must not outlive a failed authorization', () => {
  const FF_SESSION = 'ff-session-0001';

  function ffDeps(revoked: string[], active: unknown[] = []) {
    return {
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      mintFfToken: (async () => ({
        token: `ff_${randomBytes(24).toString('hex')}`,
        sessionId: FF_SESSION,
      })) as never,
      deleteSession: (async (id: string) => { revoked.push(id); }) as never,
      listSessions: (async () => active) as never,
      env: { CORTEX_FF_API_ENABLED: 'true' },
    };
  }

  it('REVOKES the credential when the upstream refuses', async () => {
    // The token is minted before the call, because Cortex needs it in the body. If the
    // call then fails, the row is a live 90-day credential no grant points at.
    const revoked: string[] = [];
    const callback = await startCallbackServer((_req, response) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{}');
    });
    const app = await startConsentHandler({ callbackBase: callback.url, ...ffDeps(revoked) });

    const response = await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(response.status).toBe(502);
    expect(revoked).toEqual([FF_SESSION]);
  });

  it('REVOKES the credential when the upstream is unreachable', async () => {
    const revoked: string[] = [];
    const app = await startConsentHandler({
      callbackBase: 'http://127.0.0.1:1',
      ...ffDeps(revoked),
    });

    const response = await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(response.status).toBe(502);
    expect(revoked).toEqual([FF_SESSION]);
  });

  it('REVOKES the credential when the redirect is unsafe', async () => {
    // A javascript: redirect never reaches the browser, so the grant never completes.
    const revoked: string[] = [];
    const callback = await startCallbackServer((_req, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ redirectUrl: 'javascript:alert(1)' }));
    });
    const app = await startConsentHandler({ callbackBase: callback.url, ...ffDeps(revoked) });

    const response = await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(response.status).toBe(502);
    expect(revoked).toEqual([FF_SESSION]);
  });

  it('KEEPS the credential when the grant succeeds', async () => {
    // The mirror. Without it, revoking unconditionally would satisfy all three above
    // while making the feature useless.
    const revoked: string[] = [];
    const callback = await startCallbackServer((_req, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
      }));
    });
    const app = await startConsentHandler({ callbackBase: callback.url, ...ffDeps(revoked) });

    const response = await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(response.status).toBe(200);
    expect(revoked).toEqual([]);
  });

  it('does not revoke anything when the grant is OFF', async () => {
    // Nothing was minted, so there is nothing to clean up — and deleteSession must not
    // be called with undefined.
    const revoked: string[] = [];
    const callback = await startCallbackServer((_req, response) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{}');
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      ...ffDeps(revoked),
      env: {},
    });

    await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(revoked).toEqual([]);
  });

  it('refuses to mint past the active-token cap, and mints nothing', async () => {
    let minted = false;
    const callback = await startCallbackServer((_req, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ redirectUrl: 'https://claude.ai/cb' }));
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      mintFfToken: (async () => { minted = true; return { token: 'x', sessionId: FF_SESSION }; }) as never,
      listSessions: (async () => new Array(10).fill({})) as never,
      env: { CORTEX_FF_API_ENABLED: 'true' },
    });

    const response = await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(response.status).toBe(400);
    expect(minted).toBe(false);
  });

  it('mints normally when under the cap', async () => {
    // The mirror for the cap: a handler that always refused would pass the case above.
    let minted = false;
    const callback = await startCallbackServer((_req, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
      }));
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      mintFfToken: (async () => { minted = true; return { token: 'x', sessionId: FF_SESSION }; }) as never,
      listSessions: (async () => new Array(9).fill({})) as never,
      env: { CORTEX_FF_API_ENABLED: 'true' },
    });

    const response = await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(response.status).toBe(200);
    expect(minted).toBe(true);
  });

  it('records the forwarded client IP, not the loopback proxy address', async () => {
    // Behind nginx on the same host req.socket.remoteAddress is always 127.0.0.1, which
    // makes the audit column useless on exactly the deployment that matters.
    const seen: Array<string | undefined> = [];
    const callback = await startCallbackServer((_req, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc',
      }));
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      mintFfToken: (async (_u: unknown, _l: unknown, opts: { ipAddress?: string }) => {
        seen.push(opts?.ipAddress);
        return { token: 'x', sessionId: FF_SESSION };
      }) as never,
      listSessions: (async () => []) as never,
      env: { CORTEX_FF_API_ENABLED: 'true' },
      headers: { 'x-forwarded-for': '196.25.1.9, 10.0.0.1' },
    });

    await app.post('/api/cortex/mcp-consent', { stateId: VALID_STATE_ID });

    expect(seen).toEqual(['196.25.1.9']);
  });
});
