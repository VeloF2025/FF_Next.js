// @vitest-environment node
/**
 * Tests for the Entra login INITIATOR (Phase 6, dark). The login route sets the
 * short-lived state + nonce cookies that the callback's CSRF / replay guards depend
 * on, so its branches (flag-off 404, method 405, unconfigured 503, happy-path
 * redirect + cookie-set) are security-relevant and exercised here with minimal
 * req/res doubles. No network is involved — login only builds a redirect URL.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ENTRA_NONCE_COOKIE,
  ENTRA_STATE_COOKIE,
} from '@/lib/cortex/entraAuth';
import handler from '../../../../pages/api/auth/entra/login';

const TENANT = 'tenant-guid';
const CLIENT = 'client-guid';

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

const makeReq = (method = 'GET') => ({ method, query: {}, cookies: {} } as never);

/** Pull the value out of a serialized `name=value; Attr; ...` Set-Cookie string. */
function cookieValue(setCookie: string[], name: string): string | undefined {
  const hit = setCookie.find((c) => c.startsWith(`${name}=`));
  if (!hit) return undefined;
  return decodeURIComponent(hit.slice(name.length + 1).split(';')[0]);
}

let savedEnv: Record<string, string | undefined>;
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
});
afterEach(() => {
  for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

describe('Entra login initiator', () => {
  it('redirects to the authorize endpoint and sets state + nonce cookies that match the URL', () => {
    const res = makeRes();
    handler(makeReq(), res as never);

    const url = new URL(res.redirectedTo as string);
    expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(url.searchParams.get('client_id')).toBe(CLIENT);
    expect(url.searchParams.get('response_type')).toBe('code');

    const setCookie = (res.headers as Record<string, string[]>)['Set-Cookie'];
    expect(setCookie).toHaveLength(2);
    // The cookie values MUST equal the state/nonce embedded in the redirect — otherwise
    // the callback's constant-time comparison can never succeed.
    expect(cookieValue(setCookie, ENTRA_STATE_COOKIE)).toBe(url.searchParams.get('state'));
    expect(cookieValue(setCookie, ENTRA_NONCE_COOKIE)).toBe(url.searchParams.get('nonce'));
    expect(setCookie.every((c) => /HttpOnly/i.test(c))).toBe(true);
  });

  it('generates a fresh state + nonce on each call (not static)', () => {
    const r1 = makeRes();
    const r2 = makeRes();
    handler(makeReq(), r1 as never);
    handler(makeReq(), r2 as never);
    const s1 = new URL(r1.redirectedTo as string).searchParams.get('state');
    const s2 = new URL(r2.redirectedTo as string).searchParams.get('state');
    expect(s1).not.toBe(s2);
  });

  it('404s when the flag is off (inert by default)', () => {
    process.env.ENTRA_SSO_ENABLED = 'false';
    const res = makeRes();
    handler(makeReq(), res as never);
    expect(res.statusCode).toBe(404);
    expect(res.redirectedTo).toBeUndefined();
  });

  it('405s on a non-GET method', () => {
    const res = makeRes();
    handler(makeReq('POST'), res as never);
    expect(res.statusCode).toBe(405);
    expect((res.headers as Record<string, unknown>)['Allow']).toBe('GET');
  });

  it('503s when the flag is on but the app registration is unconfigured', () => {
    delete process.env.ENTRA_TENANT_ID;
    delete process.env.ENTRA_CLIENT_ID;
    delete process.env.ENTRA_CLIENT_SECRET;
    delete process.env.ENTRA_REDIRECT_URI;
    const res = makeRes();
    handler(makeReq(), res as never);
    expect(res.statusCode).toBe(503);
    expect(res.redirectedTo).toBeUndefined();
  });
});
