import { afterEach, describe, expect, it } from 'vitest';

import {
  CALLBACK_SECRET,
  closeConsentContextHarnesses,
  startConsentContextHandler,
  startContextService,
  VALID_STATE_ID,
} from './mcpConsentContext.testHarness';

const GATEWAY_MESSAGE =
  'Authorization details could not be verified. Return to Claude and try connecting again.';

afterEach(closeConsentContextHarnesses);

describe('POST /api/cortex/mcp-consent-context', () => {
  it('returns only display context over the authenticated loopback request', async () => {
    const context = await startContextService((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        client_id: 'attacker-client',
        client_name: 'Claude',
        redirect_uri: 'https://evil.example/cb',
        scopes: ['cortex.read'],
        expires_at: 1_786_000_000,
        code_challenge: 'must-not-pass-through',
      }));
    });
    const app = await startConsentContextHandler({ callbackBase: context.url });

    const response = await app.post({
      stateId: VALID_STATE_ID,
      email: 'attacker@example.com',
      redirectUri: 'https://different-evil.example/cb',
    });

    expect(response.status).toBe(200);
    expect(context.requests).toEqual([{
      path: '/authorize/context',
      method: 'POST',
      cortexSecret: CALLBACK_SECRET,
      json: { stateId: VALID_STATE_ID },
    }]);
    expect(response.json.data).toEqual({
      clientId: 'attacker-client',
      clientName: 'Claude',
      redirectUri: 'https://evil.example/cb',
      scopes: ['cortex.read'],
    });
    expect(JSON.stringify(response.json)).not.toContain(CALLBACK_SECRET);
    expect(JSON.stringify(response.json)).not.toContain('code_challenge');
    expect(JSON.stringify(app.logs)).not.toContain(CALLBACK_SECRET);
  });

  it('rejects malformed state before contacting Cortex', async () => {
    const context = await startContextService((_request, response) => response.end());
    const app = await startConsentContextHandler({ callbackBase: context.url });

    const response = await app.post({ stateId: '../../etc/passwd' });

    expect(response.status).toBe(400);
    expect(response.json.error?.code).toBe('BAD_REQUEST');
    expect(context.requests).toEqual([]);
  });

  it('fails before contacting Cortex when the callback secret is absent', async () => {
    const context = await startContextService((_request, response) => response.end());
    const app = await startConsentContextHandler({
      callbackBase: context.url,
      callbackSecret: null,
    });

    const response = await app.post({ stateId: VALID_STATE_ID });

    expect(response.status).toBe(500);
    expect(response.json.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: GATEWAY_MESSAGE,
    });
    expect(context.requests).toEqual([]);
  });

  it('does not follow an upstream redirect carrying the callback secret', async () => {
    const redirected = await startContextService((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        client_id: 'stolen',
        client_name: 'Stolen',
        redirect_uri: 'https://evil.example/stolen',
        scopes: [],
      }));
    });
    const context = await startContextService((_request, response) => {
      response.writeHead(307, { location: `${redirected.url}/stolen` });
      response.end();
    });
    const app = await startConsentContextHandler({ callbackBase: context.url });

    const response = await app.post({ stateId: VALID_STATE_ID });

    expect(response.status).toBe(502);
    expect(response.json.error).toMatchObject({
      code: 'BAD_GATEWAY',
      message: GATEWAY_MESSAGE,
    });
    expect(context.requests).toHaveLength(1);
    expect(redirected.requests).toEqual([]);
  });

  it.each([
    ['non-2xx response', 400, JSON.stringify({ error: 'bad state' })],
    ['invalid JSON', 200, '{not-json'],
    ['invalid context', 200, JSON.stringify({
      client_id: 'attacker-client',
      client_name: 'sensitive-attacker-name',
      scopes: ['cortex.read'],
    })],
  ])('fails closed on %s without reflecting upstream data', async (_case, status, body) => {
    const context = await startContextService((_request, response) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
    const app = await startConsentContextHandler({ callbackBase: context.url });

    const response = await app.post({ stateId: VALID_STATE_ID });

    expect(response.status).toBe(502);
    expect(response.json.error).toEqual({
      code: 'BAD_GATEWAY',
      message: GATEWAY_MESSAGE,
    });
    expect(JSON.stringify(response.json)).not.toContain('sensitive-attacker-name');
    expect(JSON.stringify(app.logs)).not.toContain('sensitive-attacker-name');
  });

  it('times out a real unresponsive loopback service', async () => {
    const context = await startContextService(() => new Promise(() => undefined));
    const app = await startConsentContextHandler({ callbackBase: context.url });
    const startedAt = Date.now();

    const response = await app.post({ stateId: VALID_STATE_ID });

    expect(response.status).toBe(502);
    expect(Date.now() - startedAt).toBeLessThan(6_500);
  }, 8_000);
});
