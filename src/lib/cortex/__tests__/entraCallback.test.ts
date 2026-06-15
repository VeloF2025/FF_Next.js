// @vitest-environment node
/**
 * Tests for the Entra callback's server-side targeting/replay checks (Phase 6) and the
 * Phase 6h #102 access-token forwarding (dark behind CORTEX_FORWARD_TOKEN). Mocks the
 * network token exchange; exercises the ID-token aud/iss defence-in-depth check, nonce
 * replay guard, state CSRF guard, method/flag gating, and — in access-token mode — that
 * the stored/forwarded cookie holds the ACCESS token (validated for aud/exp), not the ID
 * token. The live OAuth round-trip itself remains UNTESTED (Azure config).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, decodeJwt } from 'jose';
import {
  ENTRA_ID_TOKEN_COOKIE,
  ENTRA_NONCE_COOKIE,
  ENTRA_STATE_COOKIE,
  ENTRA_VERIFIER_COOKIE,
} from '@/lib/cortex/entraAuth';

// Mock only the network exchange; keep the real flag/config/constants.
const exchangeMock = vi.fn();
vi.mock('@/lib/cortex/entraAuth', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/cortex/entraAuth')>();
  return { ...actual, exchangeCodeForTokens: (...a: unknown[]) => exchangeMock(...a) };
});

import handler from '../../../../pages/api/auth/entra/callback';

const TENANT = 'tenant-guid';
const CLIENT = 'client-guid';
const NONCE = 'the-nonce-value';
const STATE = 'the-state-value';
const VERIFIER = 'the-pkce-code-verifier-value';

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

async function jwtWith(claims: Record<string, unknown>): Promise<string> {
  // Signature is irrelevant — the callback only decodes (the bridge verifies sigs).
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(
    new TextEncoder().encode('irrelevant-test-secret-irrelevant-test'),
  );
}
const idTokenWith = jwtWith;

/** Resolve the exchange mock to `{ idToken, accessToken? }` like exchangeCodeForTokens. */
function resolveTokens(idToken: string, accessToken?: string): void {
  exchangeMock.mockResolvedValue({ idToken, accessToken });
}

let savedEnv: Record<string, string | undefined>;
// Include GRAPH_* so the 503-unconfigured test can clear the fallback config without
// leaking into other suites, and CORTEX_FORWARD_TOKEN so the access-token tests are isolated.
const ENV = [
  'ENTRA_SSO_ENABLED', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_REDIRECT_URI',
  'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'CORTEX_FORWARD_TOKEN',
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
/** Extract the JWT value stored in the forward cookie (or undefined when none). */
function forwardCookieJwt(res: Record<string, unknown>): string | undefined {
  const setCookie = (res.headers as Record<string, string[]>)['Set-Cookie'] ?? [];
  const c = setCookie.find((x) => x.startsWith(`${ENTRA_ID_TOKEN_COOKIE}=`));
  if (!c) return undefined;
  return decodeURIComponent(c.slice(`${ENTRA_ID_TOKEN_COOKIE}=`.length).split(';')[0]);
}
const validCookies = {
  [ENTRA_STATE_COOKIE]: STATE,
  [ENTRA_NONCE_COOKIE]: NONCE,
  [ENTRA_VERIFIER_COOKIE]: VERIFIER,
};

describe('Entra callback — targeting + replay guards (ID-token default path)', () => {
  it('stores the id-token cookie on a fully valid round trip and replays the PKCE verifier', async () => {
    resolveTokens(await idTokenWith(goodClaims));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex');
    const setCookie = (res.headers as Record<string, string[]>)['Set-Cookie'];
    expect(setCookie.some((c) => c.startsWith(`${ENTRA_ID_TOKEN_COOKIE}=`))).toBe(true);
    // PKCE: the verifier cookie set at login must be passed to the token exchange.
    expect(exchangeMock).toHaveBeenCalledWith(expect.anything(), 'c', VERIFIER);
    // ...and cleared afterward (maxAge=0).
    expect(setCookie.some((c) => /^ff_entra_verifier=;/.test(c) && /Max-Age=0/i.test(c))).toBe(true);
  });

  it('rejects a token whose aud is a DIFFERENT app (no id-token cookie)', async () => {
    resolveTokens(await idTokenWith({ ...goodClaims, aud: 'some-other-app' }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('fails closed when the PKCE verifier cookie is MISSING (does not exchange)', async () => {
    const res = makeRes();
    await handler(
      makeReq({ code: 'c', state: STATE }, { [ENTRA_STATE_COOKIE]: STATE, [ENTRA_NONCE_COOKIE]: NONCE }),
      res as never,
    );
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects a token from a DIFFERENT tenant issuer', async () => {
    resolveTokens(await idTokenWith({ ...goodClaims, iss: 'https://login.microsoftonline.com/evil-tenant/v2.0' }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects an issuer that only PREFIXES the tenant (look-alike tenant) — trailing-slash guard', async () => {
    resolveTokens(await idTokenWith({
      ...goodClaims,
      iss: `https://login.microsoftonline.com/${TENANT}.evil.com/v2.0`,
    }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects a nonce mismatch (replay)', async () => {
    resolveTokens(await idTokenWith({ ...goodClaims, nonce: 'attacker-nonce' }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('rejects an already-EXPIRED token (no id-token cookie)', async () => {
    resolveTokens(await idTokenWith({ ...goodClaims, exp: Math.floor(Date.now() / 1000) - 60 }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('stores a token with a FUTURE exp (freshness ok)', async () => {
    resolveTokens(await idTokenWith({ ...goodClaims, exp: Math.floor(Date.now() / 1000) + 3600 }));
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
    resolveTokens('this.is.not-a-valid-jwt');
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

describe('Entra callback — access-token forwarding (Phase 6h #102, dark behind CORTEX_FORWARD_TOKEN)', () => {
  const FUTURE = Math.floor(Date.now() / 1000) + 3600;
  const accessClaims = {
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    aud: `api://${CLIENT}`,
    scp: 'access_as_user',
    preferred_username: 'alice@velocityfibre.co.za',
    marker: 'ACCESS',
    exp: FUTURE,
  };

  it('forwards the ACCESS token (not the ID token) when CORTEX_FORWARD_TOKEN=access_token', async () => {
    process.env.CORTEX_FORWARD_TOKEN = 'access_token';
    const idTok = await idTokenWith({ ...goodClaims, marker: 'ID' });
    const accessTok = await jwtWith(accessClaims);
    resolveTokens(idTok, accessTok);
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex');
    const stored = forwardCookieJwt(res);
    expect(stored).toBe(accessTok);
    expect(decodeJwt(stored as string).marker).toBe('ACCESS'); // the access token, NOT the id token
  });

  it('accepts an access token whose aud is the bare client-id GUID (v2 aud may be either)', async () => {
    process.env.CORTEX_FORWARD_TOKEN = 'access_token';
    const accessTok = await jwtWith({ ...accessClaims, aud: CLIENT });
    resolveTokens(await idTokenWith(goodClaims), accessTok);
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex');
    expect(forwardCookieJwt(res)).toBe(accessTok);
  });

  it('fails closed when access-token mode but the exchange returns NO access token', async () => {
    process.env.CORTEX_FORWARD_TOKEN = 'access_token';
    resolveTokens(await idTokenWith(goodClaims)); // accessToken undefined
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('fails closed when the access token targets a DIFFERENT api (aud mismatch)', async () => {
    process.env.CORTEX_FORWARD_TOKEN = 'access_token';
    resolveTokens(await idTokenWith(goodClaims), await jwtWith({ ...accessClaims, aud: 'api://someone-else' }));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('fails closed when the access token is from a DIFFERENT tenant issuer', async () => {
    process.env.CORTEX_FORWARD_TOKEN = 'access_token';
    resolveTokens(
      await idTokenWith(goodClaims),
      await jwtWith({ ...accessClaims, iss: 'https://login.microsoftonline.com/evil-tenant/v2.0' }),
    );
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('fails closed when the access token is EXPIRED', async () => {
    process.env.CORTEX_FORWARD_TOKEN = 'access_token';
    resolveTokens(
      await idTokenWith(goodClaims),
      await jwtWith({ ...accessClaims, exp: Math.floor(Date.now() / 1000) - 60 }),
    );
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('still runs the ID-token nonce/replay gate in access-token mode (rejects a bad nonce)', async () => {
    process.env.CORTEX_FORWARD_TOKEN = 'access_token';
    resolveTokens(await idTokenWith({ ...goodClaims, nonce: 'attacker-nonce' }), await jwtWith(accessClaims));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex?entra_error=1');
    expect(noIdTokenCookie(res)).toBe(true);
  });

  it('still forwards the ID token when the flag is unset (default), even if an access token is present', async () => {
    const idTok = await idTokenWith({ ...goodClaims, marker: 'ID' });
    resolveTokens(idTok, await jwtWith(accessClaims));
    const res = makeRes();
    await handler(makeReq({ code: 'c', state: STATE }, validCookies), res as never);
    expect(res.redirectedTo).toBe('/cortex');
    expect(forwardCookieJwt(res)).toBe(idTok);
    expect(decodeJwt(forwardCookieJwt(res) as string).marker).toBe('ID');
  });
});
