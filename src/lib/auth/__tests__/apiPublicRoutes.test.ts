import { describe, expect, it } from 'vitest';

import {
  PUBLIC_API_PREFIXES,
  hasAnyCredential,
  isPublicApiRoute,
  wouldDenyApiRequest,
} from '../apiPublicRoutes';

function req(opts: { cookie?: string; cookieName?: string; headers?: Record<string, string> } = {}) {
  const headers = opts.headers ?? {};
  const name = opts.cookieName ?? 'ff_auth_token';
  return {
    cookies: { get: (n: string) => (n === name && opts.cookie ? { value: opts.cookie } : undefined) },
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
  it('accepts the main app session cookie', () => {
    expect(hasAnyCredential(req({ cookie: 'jwt.value.here' }))).toBe(true);
  });

  it('accepts BOTH portal session cookies — they are different systems', () => {
    // ff_my_session is the STAFF portal (withMySession, ~49 routes under /api/my:
    // attendance, payslips, receipts, stores). ff_portal_session is the FLEET portal.
    // An earlier revision listed only the fleet cookie and claimed it was the staff one;
    // the test passed because it asserted against a cookie /api/my never receives, while
    // production would have logged every real staff request as anonymous.
    expect(hasAnyCredential(req({ cookie: 'my.jwt', cookieName: 'ff_my_session' }))).toBe(true);
    expect(hasAnyCredential(req({ cookie: 'fleet.jwt', cookieName: 'ff_portal_session' }))).toBe(true);
  });

  it('does not flag real staff-portal traffic', () => {
    // The routes withMySession actually gates, with the cookie it actually sets.
    for (const p of ['/api/my/attendance/clock-in', '/api/my/payslips', '/api/my/receipts', '/api/my/hub-summary']) {
      expect(wouldDenyApiRequest(p, req({ cookie: 'm', cookieName: 'ff_my_session' })), p).toBe(false);
    }
  });

  it('accepts a bearer token', () => {
    expect(hasAnyCredential(req({ headers: { authorization: 'Bearer abc' } }))).toBe(true);
  });

  it('accepts every service secret header the codebase actually reads', () => {
    // Each verified by grep against real route code. The bridge headers matter most:
    // the Go WhatsApp Bridge is a separate VPS posting 24/7 across every monitored
    // group, so missing it would out-noise even the staff-portal gap.
    for (const h of [
      'x-api-key',
      'x-cron-secret',
      'x-bridge-secret',
      'x-wa-bridge-secret',
      'x-webhook-secret',
      'x-internal-key',
    ]) {
      expect(hasAnyCredential(req({ headers: { [h]: 'secret' } })), h).toBe(true);
    }
  });

  it('does not flag real WhatsApp-bridge traffic', () => {
    // The routes the bridge actually posts to, with the header it actually sends.
    for (const p of [
      '/api/communications/whatsapp/inbound',
      '/api/activate/dr-acknowledgment',
      '/api/field-ops/wa-message',
      '/api/noc/wa-monitored-groups',
    ]) {
      expect(wouldDenyApiRequest(p, req({ headers: { 'x-bridge-secret': 's' } })), p).toBe(false);
    }
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
    expect(wouldDenyApiRequest('/api/cortex-remote-mcp/mcp', req())).toBe(false);
    // Shared snag links are public by design — the URL token is the credential.
    expect(wouldDenyApiRequest('/api/snags/shared/abc123', req())).toBe(false);
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
