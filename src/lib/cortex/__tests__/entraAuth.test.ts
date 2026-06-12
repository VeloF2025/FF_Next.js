// @vitest-environment node
/**
 * Tests for the Entra OIDC login helpers (Phase 6, dark). Covers the pure,
 * verifiable surface: flag gating, app-reg config fallback (reuse GRAPH_*),
 * authorize-URL construction, and the server-side ID-token cookie reader. The
 * live token-exchange `fetch` and the route round-trip are UNTESTED here (network /
 * Azure config) — see entraAuth.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import {
  ENTRA_ID_TOKEN_COOKIE,
  buildAuthorizeUrl,
  entraSsoEnabled,
  getEntraConfig,
  getForwardableEntraIdToken,
  randomToken,
  readEntraIdToken,
} from '@/lib/cortex/entraAuth';

const ENV_KEYS = [
  'ENTRA_SSO_ENABLED', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET',
  'ENTRA_REDIRECT_URI', 'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET',
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
    const url = new URL(buildAuthorizeUrl(cfg, 'st4te', 'n0nce'));
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

  it('does NOT use a multi-tenant (common) endpoint', () => {
    const url = buildAuthorizeUrl(cfg, 's', 'n');
    expect(url).not.toContain('/common/');
    expect(url).not.toContain('/organizations/');
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
