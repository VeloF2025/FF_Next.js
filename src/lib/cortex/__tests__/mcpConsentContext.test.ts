import { describe, expect, it } from 'vitest';

import { parseCortexMcpConsentContext } from '../mcpConsentContext';

describe('parseCortexMcpConsentContext', () => {
  it('maps only the informed-consent display fields', () => {
    expect(parseCortexMcpConsentContext({
      client_id: 'attacker-client',
      client_name: 'Claude',
      redirect_uri: 'https://evil.example/cb',
      scopes: ['cortex.read'],
      expires_at: 1_786_000_000,
      code_challenge: 'must-not-pass-through',
    })).toEqual({
      clientId: 'attacker-client',
      clientName: 'Claude',
      redirectUri: 'https://evil.example/cb',
      scopes: ['cortex.read'],
    });
  });

  it('accepts a missing registered client name without inventing trust', () => {
    expect(parseCortexMcpConsentContext({
      client_id: 'generated-client-id',
      client_name: null,
      redirect_uri: 'http://127.0.0.1:39271/callback',
      scopes: [],
    })).toEqual({
      clientId: 'generated-client-id',
      clientName: null,
      redirectUri: 'http://127.0.0.1:39271/callback',
      scopes: [],
    });
  });

  it.each([
    ['client ID', {
      client_id: 'x'.repeat(257),
      client_name: null,
      redirect_uri: 'https://evil.example/cb',
      scopes: [],
    }],
    ['client name', {
      client_id: 'client',
      client_name: 'x'.repeat(257),
      redirect_uri: 'https://evil.example/cb',
      scopes: [],
    }],
    ['redirect URI', {
      client_id: 'client',
      client_name: null,
      redirect_uri: `https://evil.example/${'x'.repeat(2_030)}`,
      scopes: [],
    }],
    ['scope count', {
      client_id: 'client',
      client_name: null,
      redirect_uri: 'https://evil.example/cb',
      scopes: Array.from({ length: 33 }, (_, index) => `scope-${index}`),
    }],
    ['scope value', {
      client_id: 'client',
      client_name: null,
      redirect_uri: 'https://evil.example/cb',
      scopes: ['x'.repeat(129)],
    }],
  ])('rejects an oversized %s', (_field, value) => {
    expect(parseCortexMcpConsentContext(value)).toBeNull();
  });

  it.each([
    null,
    {},
    {
      client_id: '',
      client_name: null,
      redirect_uri: 'https://evil.example/cb',
      scopes: [],
    },
    {
      client_id: 'client',
      client_name: 7,
      redirect_uri: 'https://evil.example/cb',
      scopes: [],
    },
    {
      client_id: 'client',
      client_name: null,
      redirect_uri: '',
      scopes: [],
    },
    {
      client_id: 'client',
      client_name: null,
      redirect_uri: 'https://evil.example/cb',
      scopes: 'cortex.read',
    },
    {
      client_id: 'client',
      client_name: null,
      redirect_uri: 'https://evil.example/cb',
      scopes: ['cortex.read', 7],
    },
  ])('rejects malformed context %#', (value) => {
    expect(parseCortexMcpConsentContext(value)).toBeNull();
  });
});
