// @vitest-environment node
/**
 * Tests for the Entra callback's server-side targeting/replay checks (Phase 6).
 * Mocks the network token exchange; exercises the aud/iss defence-in-depth check,
 * nonce replay guard, state CSRF guard, and method/flag gating with minimal req/res
 * doubles. The live OAuth round-trip itself remains UNTESTED (Azure config).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import {
  ENTRA_ID_TOKEN_COOKIE,
  ENTRA_NONCE_COOKIE,
  ENTRA_STATE_COOKIE,
} from '@/lib/cortex/entraAuth';

// Mock only the network exchange; keep the real flag/config/constants.
const exchangeMock = vi.fn();
vi.mock('@/lib/cortex/entraAuth', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/cortex/entraAuth')>();
  return { ...actual, exchangeCodeForIdToken: (...a: unknown[]) => exchangeMock(...a) };
});

import handler from '../../../../pages/api/auth/entra/callback';

const TENANT = 'tenant-guid';
const CLIENT = 'client-guid';
const NONCE = 'the-nonce-value';
const STATE = 'the-state-value';

function makeRes() {
  const res: Record<string, unknown> = {};
  res.statusCode = 200;
  res.headers = {} as Record<string, unknown>;
  res.redirectedTo = undefined;
  res.body = undefined;
  res.setHeader = (k: string, v: unknown) => { (res.headers as Record<string, unknown>)[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.redirect = (_c: number, url: string) => { res.redirectedTo = url; return res; };
  return res;
}

function makeReq(query: Record<string, string>, cookies: Record<string, string>) {
  return { method: 'GET', query, cookies } as never;
}

async function idTokenWith(claims: Record<string, unknown>): Promise<string> {
  // Signature is irrelevant — the callback only decodes (the bridge verifies sigs).
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(
    new TextEncoder().encode('irrelevant-test-secret-irrelevant-test'),
  );
}

let savedEnv: Record<string, string | undefined>;
const ENV = ['ENTRA_SSO_ENABLED', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_REDIRECT_URI'];

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV) { savedEnv[k] = process.env[k]; }
  process.env.ENTRA_SSO_ENABLED = 'true';
  process.env.ENTRA_TENANT_ID = TENANT;
  process.env.ENTRA_CLIENT_ID = CLIENT;
  process.env.ENTRA_CLIENT_SECRET = 'secret';
  process.env.ENTRA_REDIRECT_URI = 'https://ff.example/api/auth/entra/callback';
  exchangeMock.mockReset();
});
afterEach(() => {
  for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

const goodClaims = {
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  aud: CLIENT,
  nonce: NONCE,
  preferred_username: 'alice@velocityfibre.co.za',
};

describe('Entra callback — targeting + replay guards', () => {
  it('stores the id-token cookie on a fully valid round trip', async () => {
    exchangeMock.mockResolvedValue(await idTokenWith(goodClaims));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, { [ENTRA_STATE_COOKIE]: STATE, [ENTRA_NONCE_COOKIE]: NONCE }), res as never);
    expect(res.redirectedTo).toBe('/cortex');
    const setCookie = (res.headers as Record<string, string[]>)['Set-Cookie'];
    expect(setCookie.some((c) => c.startsWith(`${ENTRA_ID_TOKEN_COOKIE}=`))).toBe(true);
  });

  it('rejects a token whose aud is a DIFFERENT app (no id-token cookie)', async () => {
    exchangeMock.mockResolvedValue(await idTokenWith({ ...goodClaims, aud: 'some-other-app' }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, { [ENTRA_STATE_COOKIE]: STATE, [ENTRA_NONCE_COOKIE]: NONCE }), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    const setCookie = (res.headers as Record<string, string[]>)['Set-Cookie'];
    expect(setCookie.some((c) => c.startsWith(`${ENTRA_ID_TOKEN_COOKIE}=`))).toBe(false);
  });

  it('rejects a token from a DIFFERENT tenant issuer', async () => {
    exchangeMock.mockResolvedValue(await idTokenWith({ ...goodClaims, iss: 'https://login.microsoftonline.com/evil-tenant/v2.0' }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, { [ENTRA_STATE_COOKIE]: STATE, [ENTRA_NONCE_COOKIE]: NONCE }), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
  });

  it('rejects a nonce mismatch (replay)', async () => {
    exchangeMock.mockResolvedValue(await idTokenWith({ ...goodClaims, nonce: 'attacker-nonce' }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, { [ENTRA_STATE_COOKIE]: STATE, [ENTRA_NONCE_COOKIE]: NONCE }), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
  });

  it('rejects a state mismatch (CSRF) before exchanging', async () => {
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: 'wrong' }, { [ENTRA_STATE_COOKIE]: STATE, [ENTRA_NONCE_COOKIE]: NONCE }), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('404s when the flag is off', async () => {
    process.env.ENTRA_SSO_ENABLED = 'false';
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, {}), res as never);
    expect(res.statusCode).toBe(404);
  });
});
