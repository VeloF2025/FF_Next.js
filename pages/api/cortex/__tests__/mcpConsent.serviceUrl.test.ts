import { afterEach, describe, expect, it } from 'vitest';

import {
  closeConsentHarnesses,
  MINTED_TOKEN,
  startConsentHandler,
  VALID_STATE_ID,
} from './mcpConsent.testHarness';

const GATEWAY_MESSAGE =
  'Authorization could not be completed. Return to Claude and try connecting again.';

afterEach(closeConsentHarnesses);

describe('Cortex consent service URL boundary', () => {
  it.each([
    ['public HTTPS', 'https://mcp.example.com:7414'],
    ['userinfo', 'http://user:pass@127.0.0.1:7414'],
    ['non-loopback', 'http://192.168.1.10:7414'],
    ['missing port', 'http://127.0.0.1'],
    ['invalid port', 'http://127.0.0.1:not-a-port'],
  ])('rejects %s before mint or fetch', async (_label, callbackBase) => {
    const mintedFor: string[] = [];
    const fetchedUrls: string[] = [];
    const app = await startConsentHandler({
      callbackBase,
      mintToken: async (email) => {
        mintedFor.push(email);
        return { token: MINTED_TOKEN, expiresAt: null };
      },
      fetchImpl: async (input) => {
        fetchedUrls.push(String(input));
        return new Response(JSON.stringify({
          redirectUrl: 'https://claude.ai/callback',
        }), { status: 200 });
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
    expect(fetchedUrls).toEqual([]);
  });

  it.each([
    'http://127.0.0.1:7414',
    'http://localhost:7414',
    'http://[::1]:7414',
  ])('accepts the explicit loopback origin %s', async (callbackBase) => {
    const fetchedUrls: string[] = [];
    const app = await startConsentHandler({
      callbackBase,
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      fetchImpl: async (input) => {
        fetchedUrls.push(String(input));
        return new Response(JSON.stringify({
          redirectUrl: 'https://claude.ai/callback',
        }), { status: 200 });
      },
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expect(response.status).toBe(200);
    expect(fetchedUrls).toEqual([`${callbackBase}/authorize/complete`]);
  });

  it('preserves the default loopback service URL', async () => {
    const fetchedUrls: string[] = [];
    const app = await startConsentHandler({
      mintToken: async () => ({ token: MINTED_TOKEN, expiresAt: null }),
      fetchImpl: async (input) => {
        fetchedUrls.push(String(input));
        return new Response(JSON.stringify({
          redirectUrl: 'https://claude.ai/callback',
        }), { status: 200 });
      },
    });

    const response = await app.post('/api/cortex/mcp-consent', {
      stateId: VALID_STATE_ID,
    });

    expect(response.status).toBe(200);
    expect(fetchedUrls).toEqual([
      'http://127.0.0.1:7414/authorize/complete',
    ]);
  });
});
