import { afterEach, describe, expect, it } from 'vitest';

import {
  CALLBACK_SECRET,
  closeConsentHarnesses,
  MINTED_TOKEN,
  startCallbackServer,
  startConsentHandler,
  type HarnessResponse,
  VALID_STATE_ID,
} from './support/mcpConsent.testHarness';

const GATEWAY_MESSAGE =
  'Authorization could not be completed. Return to Claude and try connecting again.';

afterEach(closeConsentHarnesses);

function expectGatewayFailure(
  response: HarnessResponse,
  logs: unknown[],
): void {
  expect(response.status).toBe(502);
  expect(response.json).toMatchObject({
    success: false,
    error: {
      code: 'BAD_GATEWAY',
      message: GATEWAY_MESSAGE,
    },
  });
  expect(response.json.meta?.timestamp).toEqual(expect.any(String));
  expect(JSON.stringify(response.json)).not.toContain(MINTED_TOKEN);
  expect(JSON.stringify(response.json)).not.toContain(CALLBACK_SECRET);
  expect(JSON.stringify(logs)).not.toContain(MINTED_TOKEN);
  expect(JSON.stringify(logs)).not.toContain(CALLBACK_SECRET);
}

describe('POST /api/cortex/mcp-consent — request gates', () => {
  it.each([
    ['missing', {}],
    ['blank', { stateId: '' }],
    ['too short', { stateId: 'abc' }],
    ['containing whitespace', { stateId: 'valid-looking state id' }],
    ['non-string', { stateId: { nested: true } }],
  ])('rejects a %s stateId before mint or callback', async (_label, body) => {
    const mintedFor: Array<[string, '90d']> = [];
    const callback = await startCallbackServer((_request, response) => {
      response.end(JSON.stringify({ redirectUrl: 'https://claude.ai/callback' }));
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async (email, lifetime) => {
        mintedFor.push([email, lifetime]);
        return { token: MINTED_TOKEN, expiresAt: null };
      },
    });

    const response = await app.post('/api/cortex/mcp-consent', body);

    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'stateId is missing or malformed',
      },
    });
    expect(mintedFor).toEqual([]);
    expect(callback.requests).toEqual([]);
  });

  it('500s before mint when CORTEX_MCP_CALLBACK_SECRET is missing', async () => {
    const mintedFor: Array<[string, '90d']> = [];
    const callback = await startCallbackServer((_request, response) => response.end());
    const app = await startConsentHandler({
      callbackBase: callback.url,
      callbackSecret: null,
      mintToken: async (email, lifetime) => {
        mintedFor.push([email, lifetime]);
        return { token: MINTED_TOKEN, expiresAt: null };
      },
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expect(response.status).toBe(500);
    expect(response.json).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: GATEWAY_MESSAGE },
    });
    expect(mintedFor).toEqual([]);
    expect(callback.requests).toEqual([]);
  });
});

describe('POST /api/cortex/mcp-consent — upstream failures', () => {
  it('fails closed on a non-2xx callback without leaking credentials', async () => {
    const callback = await startCallbackServer((_request, response) => {
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ detail: 'state expired' }));
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expectGatewayFailure(response, app.logs);
  });

  it.each([
    ['rejection', new Error('ECONNREFUSED')],
    ['timeout', new DOMException('timed out', 'TimeoutError')],
  ])('fails closed on callback %s', async (_label, callbackError) => {
    const callback = await startCallbackServer((_request, response) => response.end());
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      fetchImpl: async () => {
        throw callbackError;
      },
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expectGatewayFailure(response, app.logs);
    expect(callback.requests).toEqual([]);
  });

  it('fails closed on invalid callback JSON', async () => {
    const callback = await startCallbackServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{not-json');
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expectGatewayFailure(response, app.logs);
  });

  it('fails closed when the callback omits redirectUrl', async () => {
    const callback = await startCallbackServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accepted: true }));
    });
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expectGatewayFailure(response, app.logs);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/callback',
    '/relative/callback',
  ])('fails closed on unsafe redirect %s', async (redirectUrl) => {
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

    expectGatewayFailure(response, app.logs);
    expect(JSON.stringify(response.json)).not.toContain(redirectUrl);
  });

  it('maps a mint failure to a structured 500 without calling back', async () => {
    const callback = await startCallbackServer((_request, response) => response.end());
    const app = await startConsentHandler({
      callbackBase: callback.url,
      mintToken: async () => {
        throw new Error('mint unavailable');
      },
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expect(response.status).toBe(500);
    expect(response.json).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(response.json.meta?.timestamp).toEqual(expect.any(String));
    expect(callback.requests).toEqual([]);
  });
});
