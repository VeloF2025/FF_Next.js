import { afterEach, describe, expect, it, vi } from 'vitest';

import handler from '../../pages/api/mcp/resource-metadata';

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
    const res = call({ host: 'dev.fibreflow.app' });
    expect(body(res)).toEqual({
      resource: 'https://dev.fibreflow.app/api/ff-remote-mcp/mcp',
      authorization_servers: ['https://dev.fibreflow.app/api/ff-remote-mcp'],
      scopes_supported: ['fibreflow.read'],
      bearer_methods_supported: ['header'],
    });
  });

  it('does not send a dev connector to production', () => {
    const payload = body(call({ host: 'dev.fibreflow.app' }));
    // The exact bug the static file had.
    expect(JSON.stringify(payload)).not.toContain('app.fibreflow.app/api');
  });

  it('prefers x-forwarded-host, which is what the edge sets', () => {
    const payload = body(call({ host: 'localhost:3005', 'x-forwarded-host': 'dev.fibreflow.app' }));
    expect(payload.resource).toBe('https://dev.fibreflow.app/api/ff-remote-mcp/mcp');
  });

  it('takes the first entry of a comma-joined x-forwarded-host', () => {
    const payload = body(call({ 'x-forwarded-host': 'dev.fibreflow.app, inner.local' }));
    expect(payload.resource).toBe('https://dev.fibreflow.app/api/ff-remote-mcp/mcp');
  });

  it('lets FF_APP_BASE pin the value regardless of the request host', () => {
    process.env.FF_APP_BASE = 'https://app.fibreflow.app/';
    const payload = body(call({ host: 'attacker.example' }));
    expect(payload.resource).toBe('https://app.fibreflow.app/api/ff-remote-mcp/mcp');
    expect(payload.authorization_servers).toEqual(['https://app.fibreflow.app/api/ff-remote-mcp']);
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
    const res = call({ host: 'dev.fibreflow.app' }, 'POST');
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('serves HEAD, which discovery clients use to probe', () => {
    const res = call({ host: 'dev.fibreflow.app' }, 'HEAD');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
