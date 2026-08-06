import { describe, it, expect, vi } from 'vitest';
import { PortalSession, CookieJar } from '../session';

function res(status: number, body = '', headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

describe('CookieJar', () => {
  it('accumulates cookies and renders a header', () => {
    const jar = new CookieJar();
    jar.absorb(res(200, '', { 'set-cookie': 'a=1; Path=/; HttpOnly' }));
    expect(jar.header()).toContain('a=1');
  });
});

describe('PortalSession', () => {
  it('logs in once, then reuses the session', async () => {
    const login = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => res(200, 'ok'));
    const s = new PortalSession({
      baseUrl: 'https://x.test', login, isLoggedOut: () => false, fetchImpl,
    });
    await s.request('/a');
    await s.request('/b');
    expect(login).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('re-authenticates exactly once when the session is killed mid-run', async () => {
    const login = vi.fn(async () => {});
    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls === 1 ? res(302) : res(200, 'ok')));
    const s = new PortalSession({
      baseUrl: 'https://x.test', login,
      isLoggedOut: (r) => r.status === 302, fetchImpl,
    });
    const out = await s.request('/a');
    expect(out.status).toBe(200);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('gives up rather than looping when re-auth does not help', async () => {
    const login = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => res(302));
    const s = new PortalSession({
      baseUrl: 'https://x.test', login,
      isLoggedOut: () => true, fetchImpl,
    });
    await expect(s.request('/a')).rejects.toThrow(/still logged out/i);
    expect(login).toHaveBeenCalledTimes(2);
  });
});
