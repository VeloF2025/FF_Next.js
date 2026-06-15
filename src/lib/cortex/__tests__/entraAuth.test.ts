// @vitest-environment node
/**
 * Tests for the Entra OIDC login helpers (Phase 6, dark). Covers the pure,
 * verifiable surface: flag gating, app-reg config fallback (reuse GRAPH_*),
 * authorize-URL construction, and the server-side ID-token cookie reader. The
 * live token-exchange `fetch` and the route round-trip are UNTESTED here (network /
 * Azure config) — see entraAuth.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import {
  ENTRA_ID_TOKEN_COOKIE,
  buildAuthorizeUrl,
  computeCodeChallenge,
  entraScope,
  entraSsoEnabled,
  exchangeCodeForTokens,
  forwardAccessToken,
  generateCodeVerifier,
  getEntraConfig,
  getForwardableEntraIdToken,
  randomToken,
  readEntraIdToken,
} from '@/lib/cortex/entraAuth';

const ENV_KEYS = [
  'ENTRA_SSO_ENABLED', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET',
  'ENTRA_REDIRECT_URI', 'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET',
  'ENTRA_SCOPE', 'CORTEX_FORWARD_TOKEN',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('entraSsoEnabled — inert unless explicitly on', () => {
  it('false when unset', () => expect(entraSsoEnabled()).toBe(false));
  it('false for "1"/"yes" (strict "true" only)', () => {
    process.env.ENTRA_SSO_ENABLED = '1';
    expect(entraSsoEnabled()).toBe(false);
  });
  it('true only for "true" (case-insensitive)', () => {
    process.env.ENTRA_SSO_ENABLED = 'TRUE';
    expect(entraSsoEnabled()).toBe(true);
  });
});

describe('getEntraConfig — reuse the existing Graph app registration', () => {
  it('returns null when incomplete (fail closed)', () => {
    process.env.GRAPH_TENANT_ID = 't';
    expect(getEntraConfig()).toBeNull(); // no client id/secret/redirect
  });

  it('falls back to GRAPH_* when ENTRA_* unset', () => {
    process.env.GRAPH_TENANT_ID = 'tenant-guid';
    process.env.GRAPH_CLIENT_ID = 'client-guid';
    process.env.GRAPH_CLIENT_SECRET = 'shh';
    process.env.ENTRA_REDIRECT_URI = 'https://ff.example/api/auth/entra/callback';
    expect(getEntraConfig()).toEqual({
      tenantId: 'tenant-guid',
      clientId: 'client-guid',
      clientSecret: 'shh',
      redirectUri: 'https://ff.example/api/auth/entra/callback',
    });
  });

  it('prefers dedicated ENTRA_* over GRAPH_* when both set', () => {
    process.env.GRAPH_TENANT_ID = 'graph-t';
    process.env.GRAPH_CLIENT_ID = 'graph-c';
    process.env.GRAPH_CLIENT_SECRET = 'graph-s';
    process.env.ENTRA_TENANT_ID = 'entra-t';
    process.env.ENTRA_CLIENT_ID = 'entra-c';
    process.env.ENTRA_CLIENT_SECRET = 'entra-s';
    process.env.ENTRA_REDIRECT_URI = 'https://ff.example/cb';
    expect(getEntraConfig()).toMatchObject({ tenantId: 'entra-t', clientId: 'entra-c' });
  });
});

describe('buildAuthorizeUrl', () => {
  const cfg = {
    tenantId: 'tenant-guid', clientId: 'client-guid', clientSecret: 'x',
    redirectUri: 'https://ff.example/api/auth/entra/callback',
  };

  it('targets the SINGLE-tenant authorize endpoint and requests an ID token', () => {
    const url = new URL(buildAuthorizeUrl(cfg, 'st4te', 'n0nce', 'chal1enge'));
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/tenant-guid/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('client_id')).toBe('client-guid');
    expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('nonce')).toBe('n0nce');
  });

  it('carries the PKCE S256 challenge', () => {
    const url = new URL(buildAuthorizeUrl(cfg, 's', 'n', 'the-challenge'));
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('does NOT use a multi-tenant (common) endpoint', () => {
    const url = buildAuthorizeUrl(cfg, 's', 'n', 'c');
    expect(url).not.toContain('/common/');
    expect(url).not.toContain('/organizations/');
  });

  it('requests the configured ENTRA_SCOPE when set (dedicated-app access-token cutover)', () => {
    process.env.ENTRA_SCOPE =
      'openid profile email offline_access api://cortex-app/access_as_user';
    const url = new URL(buildAuthorizeUrl(cfg, 's', 'n', 'c'));
    expect(url.searchParams.get('scope')).toBe(
      'openid profile email offline_access api://cortex-app/access_as_user',
    );
  });
});

describe('entraScope — default vs dedicated-app override (dark by default)', () => {
  it('defaults to "openid profile email" when unset', () => {
    expect(entraScope()).toBe('openid profile email');
  });
  it('defaults when set to blank/whitespace (fail safe to today)', () => {
    process.env.ENTRA_SCOPE = '   ';
    expect(entraScope()).toBe('openid profile email');
  });
  it('returns the configured scope (trimmed) when set', () => {
    process.env.ENTRA_SCOPE = '  openid profile email offline_access api://x/access_as_user  ';
    expect(entraScope()).toBe('openid profile email offline_access api://x/access_as_user');
  });
});

describe('forwardAccessToken — inert unless explicitly access_token', () => {
  it('false when unset (forward the ID token, today)', () => expect(forwardAccessToken()).toBe(false));
  it('false for any other value', () => {
    process.env.CORTEX_FORWARD_TOKEN = 'id_token';
    expect(forwardAccessToken()).toBe(false);
  });
  it('true only for "access_token" (case-insensitive, trimmed)', () => {
    process.env.CORTEX_FORWARD_TOKEN = '  Access_Token ';
    expect(forwardAccessToken()).toBe(true);
  });
});

describe('exchangeCodeForTokens — returns both tokens + forwards the configured scope', () => {
  const cfg = {
    tenantId: 'tenant-guid', clientId: 'client-guid', clientSecret: 'secret',
    redirectUri: 'https://ff.example/api/auth/entra/callback',
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns { idToken, accessToken } and sends entraScope() + PKCE verifier in the body', async () => {
    process.env.ENTRA_SCOPE = 'openid profile email offline_access api://x/access_as_user';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: 'the.id.token', access_token: 'the.access.token' }),
    });
    const tokens = await exchangeCodeForTokens(cfg, 'the-code', 'the-verifier');
    expect(tokens).toEqual({ idToken: 'the.id.token', accessToken: 'the.access.token' });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get('scope')).toBe('openid profile email offline_access api://x/access_as_user');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('accessToken is undefined when the response omits it (id-token-only default)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id_token: 'only.id.token' }) });
    const tokens = await exchangeCodeForTokens(cfg, 'c', 'v');
    expect(tokens.idToken).toBe('only.id.token');
    expect(tokens.accessToken).toBeUndefined();
  });

  it('throws (never returns partial) on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    await expect(exchangeCodeForTokens(cfg, 'c', 'v')).rejects.toThrow();
  });

  it('throws when the response carries no id_token', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'a' }) });
    await expect(exchangeCodeForTokens(cfg, 'c', 'v')).rejects.toThrow();
  });
});

describe('PKCE — generateCodeVerifier / computeCodeChallenge (RFC 7636 S256)', () => {
  it('generates a verifier within the 43–128 char unreserved-charset rule, unpredictable', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a.length).toBeLessThanOrEqual(128);
    // base64url charset only — no '+', '/', or '=' padding (RFC 7636 unreserved set).
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('computes the challenge per the RFC 7636 Appendix B test vector', () => {
    // verifier → BASE64URL(SHA256(verifier)) from RFC 7636 §B.
    expect(computeCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('produces a URL-safe challenge (no padding / unsafe chars) for a generated verifier', () => {
    const challenge = computeCodeChallenge(generateCodeVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(challenge).not.toContain('=');
    expect(challenge.length).toBe(43); // SHA-256 → 32 bytes → 43 base64url chars
  });
});

describe('readEntraIdToken — server-side cookie only', () => {
  it('returns the token when the cookie is present', () => {
    expect(readEntraIdToken({ [ENTRA_ID_TOKEN_COOKIE]: 'the.id.token' })).toBe('the.id.token');
  });
  it('returns undefined when absent or blank', () => {
    expect(readEntraIdToken(undefined)).toBeUndefined();
    expect(readEntraIdToken({})).toBeUndefined();
    expect(readEntraIdToken({ [ENTRA_ID_TOKEN_COOKIE]: '   ' })).toBeUndefined();
  });
});

describe('randomToken', () => {
  it('is hex and unpredictable across calls', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(a).not.toBe(b);
    expect(a.length).toBe(64); // 32 bytes hex
  });
});

describe('getForwardableEntraIdToken — identity binding + freshness', () => {
  const REVIEWER = 'alice@velocityfibre.co.za';
  const FUTURE = Math.floor(Date.now() / 1000) + 3600;
  const PAST = Math.floor(Date.now() / 1000) - 60;

  // Build an unsigned-but-decodable id token. The function only decodes (the bridge
  // verifies sigs), so the signing secret is irrelevant.
  async function idToken(claims: Record<string, unknown>): Promise<string> {
    return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(
      new TextEncoder().encode('irrelevant-test-secret-irrelevant-test'),
    );
  }
  const cookie = (t: string) => ({ [ENTRA_ID_TOKEN_COOKIE]: t });

  it('returns the token when preferred_username matches the FF reviewer', async () => {
    const t = await idToken({ preferred_username: REVIEWER, exp: FUTURE });
    expect(getForwardableEntraIdToken(cookie(t), REVIEWER)).toBe(t);
  });

  it('matches on `email` and `upn` claims too', async () => {
    const byEmail = await idToken({ email: REVIEWER, exp: FUTURE });
    const byUpn = await idToken({ upn: REVIEWER, exp: FUTURE });
    expect(getForwardableEntraIdToken(cookie(byEmail), REVIEWER)).toBe(byEmail);
    expect(getForwardableEntraIdToken(cookie(byUpn), REVIEWER)).toBe(byUpn);
  });

  it('is case-insensitive on the email comparison', async () => {
    const t = await idToken({ preferred_username: 'Alice@VelocityFibre.co.za', exp: FUTURE });
    expect(getForwardableEntraIdToken(cookie(t), REVIEWER)).toBe(t);
  });

  it('returns undefined when the token subject is a DIFFERENT user (cross-user guard)', async () => {
    const t = await idToken({ preferred_username: 'mallory@velocityfibre.co.za', exp: FUTURE });
    expect(getForwardableEntraIdToken(cookie(t), REVIEWER)).toBeUndefined();
  });

  it('returns undefined when the token carries no identity claim', async () => {
    const t = await idToken({ sub: 'opaque-guid', exp: FUTURE });
    expect(getForwardableEntraIdToken(cookie(t), REVIEWER)).toBeUndefined();
  });

  it('fails closed for an ACCESS-token-shaped artifact lacking an email-bearing claim', async () => {
    // An Entra v2 access token carries email/preferred_username/upn ONLY when configured as
    // access-token optional claims on the resource app. Without one, the ACL has no subject —
    // forwarding must NOT happen (→ undefined → HS256 fallback), never a no-email admit.
    const accessNoEmail = await idToken({ oid: 'durable-oid', sub: 'sub', scp: 'access_as_user', exp: FUTURE });
    expect(getForwardableEntraIdToken(cookie(accessNoEmail), REVIEWER)).toBeUndefined();
  });

  it('returns undefined for an EXPIRED token even when the subject matches', async () => {
    const t = await idToken({ preferred_username: REVIEWER, exp: PAST });
    expect(getForwardableEntraIdToken(cookie(t), REVIEWER)).toBeUndefined();
  });

  it('accepts a matching token with no exp claim (freshness optional)', async () => {
    const t = await idToken({ preferred_username: REVIEWER });
    expect(getForwardableEntraIdToken(cookie(t), REVIEWER)).toBe(t);
  });

  it('returns undefined for an unparseable token (never throws)', () => {
    expect(getForwardableEntraIdToken(cookie('not-a-jwt'), REVIEWER)).toBeUndefined();
  });

  it('returns undefined when the cookie is absent or the reviewer email is blank', async () => {
    const t = await idToken({ preferred_username: REVIEWER, exp: FUTURE });
    expect(getForwardableEntraIdToken(undefined, REVIEWER)).toBeUndefined();
    expect(getForwardableEntraIdToken({}, REVIEWER)).toBeUndefined();
    expect(getForwardableEntraIdToken(cookie(t), '')).toBeUndefined();
    expect(getForwardableEntraIdToken(cookie(t), undefined)).toBeUndefined();
  });
});
