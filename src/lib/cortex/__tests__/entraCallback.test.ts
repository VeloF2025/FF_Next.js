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
// Include GRAPH_* so the 503-unconfigured test can clear the fallback config without
// leaking into other suites — all are saved and restored.
const ENV = [
  'ENTRA_SSO_ENABLED', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_REDIRECT_URI',
  'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET',
];

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
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

/** Assert the response set NO id-token cookie (the core fail-closed invariant). */
function noIdTokenCookie(res: Record<string, unknown>): boolean {
  const setCookie = (res.headers as Record<string, string[]>)['Set-Cookie'] ?? [];
  return !setCookie.some((c) => c.startsWith(`${ENTRA_ID_TOKEN_COOKIE}=`));
}
const validCookies = { [ENTRA_STATE_COOKIE]: STATE, [ENTRA_NONCE_COOKIE]: NONCE };

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
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects an issuer that only PREFIXES the tenant (look-alike tenant) — trailing-slash guard', async () => {
    // `.../tenant-guid.evil.com/...` starts with `.../tenant-guid` but NOT `.../tenant-guid/`.
    exchangeMock.mockResolvedValue(await idTokenWith({
      ...goodClaims,
      iss: `https://login.microsoftonline.com/${TENANT}.evil.com/v2.0`,
    }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects a nonce mismatch (replay)', async () => {
    exchangeMock.mockResolvedValue(await idTokenWith({ ...goodClaims, nonce: 'attacker-nonce' }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects an already-EXPIRED token (no id-token cookie)', async () => {
    exchangeMock.mockResolvedValue(await idTokenWith({ ...goodClaims, exp: Math.floor(Date.now() / 1000) - 60 }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('stores a token with a FUTURE exp (freshness ok)', async () => {
    exchangeMock.mockResolvedValue(await idTokenWith({ ...goodClaims, exp: Math.floor(Date.now() / 1000) + 3600 }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex');
    expect(noIdTokenCookie(res)).toBe(false);
  });

  it('fails closed when the token exchange THROWS (no id-token cookie)', async () => {
    exchangeMock.mockRejectedValue(new Error('network down'));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('fails closed when the exchange returns an UNPARSEABLE token', async () => {
    exchangeMock.mockResolvedValue('this.is.not-a-valid-jwt');
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects a state mismatch (CSRF) before exchanging', async () => {
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: 'wrong' }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects a missing authorization code (after a valid state)', async () => {
    const res = makeRes();
    await handler(makeReq({ state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('404s when the flag is off', async () => {
    process.env.ENTRA_SSO_ENABLED = 'false';
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, {}), res as never);
    expect(res.statusCode).toBe(404);
  });

  it('405s on a non-GET method', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, cookies: {} } as never, res as never);
    expect(res.statusCode).toBe(405);
    expect((res.headers as Record<string, unknown>)['Allow']).toBe('GET');
  });

  it('503s when the flag is on but the app registration is unconfigured', async () => {
    for (const k of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_REDIRECT_URI', 'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET']) {
      delete process.env[k];
    }
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.statusCode).toBe(503);
  });
});
