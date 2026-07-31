import { afterEach, describe, expect, it, vi } from 'vitest';

import handler, {
  buildResourceMetadata,
} from '../../pages/api/mcp/resource-metadata';

type MockRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
};

const makeRes = (): MockRes => {
  const r = {} as MockRes;
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  r.setHeader = vi.fn().mockReturnValue(r);
  return r;
};

const body = (res: MockRes) => res.json.mock.calls[0][0];

const call = (headers: Record<string, string | string[]>, method = 'GET') => {
  const res = makeRes();
  handler({ method, headers } as never, res as never);
  return res;
};

describe('/.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp', () => {
  afterEach(() => {
    delete process.env.FF_APP_BASE;
  });

  it('advertises the host the request arrived on, not a hardcoded one', () => {
    expect(body(call({ host: 'dev.fibreflow.app' }))).toEqual({
      resource: 'https://dev.fibreflow.app/api/ff-remote-mcp/mcp',
      authorization_servers: ['https://dev.fibreflow.app/api/ff-remote-mcp'],
      scopes_supported: ['fibreflow.read'],
      bearer_methods_supported: ['header'],
    });
  });

  it('does not send a dev connector to production', () => {
    // The exact bug the deleted static file had.
    expect(JSON.stringify(body(call({ host: 'dev.fibreflow.app' })))).not.toContain(
      'app.fibreflow.app/api'
    );
  });

  it.each([
    ['app.fibreflow.app', 'dev.fibreflow.app'],
    ['dev.fibreflow.app', 'app.fibreflow.app'],
  ])(
    'keeps discovery on %s when x-forwarded-host names %s',
    (host, forwardedHost) => {
      const payload = buildResourceMetadata({
        host,
        'x-forwarded-host': forwardedHost,
      });
      expect(payload.resource).toBe(`https://${host}/api/ff-remote-mcp/mcp`);
    },
  );

  // --- the header is attacker-controlled: nginx never sets or strips it ---

  const ALLOWED = [
    'https://app.fibreflow.app/api/ff-remote-mcp',
    'https://dev.fibreflow.app/api/ff-remote-mcp',
  ];

  it.each([
    // A spoofed forwarded header must lose to the genuine Host, not override it.
    ['a spoofed x-forwarded-host', { host: 'dev.fibreflow.app', 'x-forwarded-host': 'evil.example' }],
    ['a spoofed Host', { host: 'evil.example' }],
    ['a look-alike subdomain', { host: 'dev.fibreflow.app.evil.example' }],
    ['a look-alike prefix', { host: 'evil-dev.fibreflow.app.co' }],
    ['a comma-smuggled second host', { 'x-forwarded-host': 'evil.example, dev.fibreflow.app' }],
    ['both headers spoofed', { host: 'evil.example', 'x-forwarded-host': 'evil.example' }],
  ])('never names an attacker host as the authorization server — %s', (_label, headers) => {
    const payload = body(call(headers as Record<string, string>));
    expect(JSON.stringify(payload)).not.toContain('evil');
    // Whatever it resolves to must be an allow-listed environment, never the claim.
    expect(ALLOWED).toContain(payload.authorization_servers[0]);
  });

  it('never marks the response publicly cacheable', () => {
    // It varies by request host; a shared cache keyed on path alone could hand one
    // environment's document — or a poisoned one — to another client.
    const res = call({ host: 'dev.fibreflow.app' });
    const cacheControl = res.setHeader.mock.calls.find((c) => c[0] === 'Cache-Control')?.[1];
    expect(cacheControl).toBe('no-store');
    expect(String(cacheControl)).not.toContain('public');
  });

  it('lets FF_APP_BASE pin the value regardless of the request host', () => {
    // Pinned to dev, NOT prod: prod is also the no-match fallback, so pinning to it
    // would produce the same answer with the pin removed and prove nothing.
    process.env.FF_APP_BASE = 'https://dev.fibreflow.app/';
    const payload = body(call({ host: 'app.fibreflow.app' }));
    expect(payload.resource).toBe('https://dev.fibreflow.app/api/ff-remote-mcp/mcp');
    expect(payload.authorization_servers).toEqual(['https://dev.fibreflow.app/api/ff-remote-mcp']);
  });

  it('uses http for local development hosts', () => {
    expect(body(call({ host: 'localhost:3004' })).resource).toBe(
      'http://localhost:3004/api/ff-remote-mcp/mcp'
    );
  });

  it('falls back to production when no host header is present', () => {
    expect(body(call({})).resource).toBe('https://app.fibreflow.app/api/ff-remote-mcp/mcp');
  });

  it('rejects non-GET methods', () => {
    expect(call({ host: 'dev.fibreflow.app' }, 'POST').status).toHaveBeenCalledWith(405);
  });

  it('serves HEAD, which discovery clients use to probe', () => {
    expect(call({ host: 'dev.fibreflow.app' }, 'HEAD').status).toHaveBeenCalledWith(200);
  });
});
