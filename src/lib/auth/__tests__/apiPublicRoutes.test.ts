import { describe, expect, it } from 'vitest';

import {
  PUBLIC_API_PREFIXES,
  hasAnyCredential,
  isPublicApiRoute,
  wouldDenyApiRequest,
} from '../apiPublicRoutes';

function req(opts: { cookie?: string; headers?: Record<string, string> } = {}) {
  const headers = opts.headers ?? {};
  return {
    cookies: { get: (n: string) => (n === 'ff_auth_token' && opts.cookie ? { value: opts.cookie } : undefined) },
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  };
}

describe('isPublicApiRoute', () => {
  it('matches a listed prefix exactly and below it', () => {
    expect(isPublicApiRoute('/api/health')).toBe(true);
    expect(isPublicApiRoute('/api/health/db')).toBe(true);
    expect(isPublicApiRoute('/api/auth/login')).toBe(true);
  });

  it('does not match on a shared string prefix without a boundary', () => {
    // '/api/healthcheck' must NOT inherit '/api/health'. Sloppy startsWith matching here
    // is how an allowlist silently widens.
    expect(isPublicApiRoute('/api/healthcheck')).toBe(false);
    expect(isPublicApiRoute('/api/authorised-users')).toBe(false);
  });

  it('leaves ordinary business routes non-public', () => {
    for (const p of ['/api/noc/tickets', '/api/contractors', '/api/conduit/projects', '/api/projects']) {
      expect(isPublicApiRoute(p), p).toBe(false);
    }
  });

  it('documents a reason for every entry', () => {
    // An allowlist entry nobody can justify is one that should be removed.
    for (const { prefix, why } of PUBLIC_API_PREFIXES) {
      expect(prefix.startsWith('/api/'), prefix).toBe(true);
      expect(why.length, prefix).toBeGreaterThan(10);
    }
  });
});

describe('hasAnyCredential', () => {
  it('accepts a session cookie', () => {
    expect(hasAnyCredential(req({ cookie: 'jwt.value.here' }))).toBe(true);
  });

  it('accepts a bearer token', () => {
    expect(hasAnyCredential(req({ headers: { authorization: 'Bearer abc' } }))).toBe(true);
  });

  it('accepts a service secret header', () => {
    expect(hasAnyCredential(req({ headers: { 'x-cron-secret': 's' } }))).toBe(true);
  });

  it('rejects an empty or absent credential', () => {
    expect(hasAnyCredential(req())).toBe(false);
    expect(hasAnyCredential(req({ cookie: '' }))).toBe(false);
    expect(hasAnyCredential(req({ headers: { authorization: '   ' } }))).toBe(false);
  });
});

describe('wouldDenyApiRequest', () => {
  it('flags an anonymous call to a business route', () => {
    expect(wouldDenyApiRequest('/api/noc/tickets', req())).toBe(true);
    expect(wouldDenyApiRequest('/api/contractors', req())).toBe(true);
  });

  it('does not flag the same route when a credential is present', () => {
    expect(wouldDenyApiRequest('/api/noc/tickets', req({ cookie: 'jwt' }))).toBe(false);
  });

  it('does not flag public routes even when anonymous', () => {
    expect(wouldDenyApiRequest('/api/health', req())).toBe(false);
    expect(wouldDenyApiRequest('/api/auth/login', req())).toBe(false);
    // MCP transport must stay anonymous so the upstream can issue its own 401 challenge.
    expect(wouldDenyApiRequest('/api/ff-remote-mcp/mcp', req())).toBe(false);
  });

  it('ignores non-API paths entirely', () => {
    expect(wouldDenyApiRequest('/noc/tickets', req())).toBe(false);
    expect(wouldDenyApiRequest('/sign-in', req())).toBe(false);
  });

  it('flags the exact routes the 2026-07-27 audit found open', () => {
    const found = [
      '/api/noc/teams',
      '/api/contractors',
      '/api/noc/project-team-assignments',
      '/api/noc/sync/fibertime',
      '/api/conduit/projects',
      '/api/noc/tickets/abc/verification',
    ];
    for (const p of found) expect(wouldDenyApiRequest(p, req()), p).toBe(true);
  });
});
