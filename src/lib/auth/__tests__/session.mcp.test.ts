import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ text: string; values: unknown[] }> = [];

// The module under test uses a tagged-template `sql` binding. Capture the interpolated
// values so we can assert on what would be written, without touching a database.
vi.mock('@/lib/db-neon', () => ({
  neon: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve([]);
  },
}));

import {
  createSession,
  deleteAllUserSessions,
  deleteEveryUserSession,
  getUserSessions,
  setSessionTokenHash,
} from '../session';

describe('createSession with MCP options', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('defaults to a browser session expiring in 30 days', async () => {
    const before = Date.now();
    const session = await createSession('user-1', '');
    expect(session.kind).toBe('browser');
    const days = (session.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('honours kind, expiryDays and label', async () => {
    const before = Date.now();
    const session = await createSession('user-1', '', undefined, undefined, {
      kind: 'mcp',
      expiryDays: 90,
      label: 'Claude desktop',
    });
    expect(session.kind).toBe('mcp');
    expect(session.label).toBe('Claude desktop');
    const days = (session.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
    expect(calls[0]!.values).toContain('mcp');
    expect(calls[0]!.values).toContain('Claude desktop');
  });

  it('setSessionTokenHash updates the row for that session id', async () => {
    await setSessionTokenHash('sess-1', 'the.jwt.value');
    expect(calls[0]!.text).toContain('UPDATE user_sessions');
    expect(calls[0]!.values).toContain('sess-1');
    expect(calls[0]!.values).toContain('the.jwt.value');
  });
});

/**
 * The session-KIND scoping is the security-relevant change in this PR, and it had no
 * coverage: `deleteAllUserSessions` now deletes FEWER rows than before (browser only by
 * default), and `deleteEveryUserSession` is the sweep that must not miss anything.
 *
 * Getting the split backwards in either direction is bad in a different way:
 *   - if logout swept mcp sessions, every connector would die on any logout
 *   - if a password reset did NOT sweep them, a compromised account would keep a live
 *     90-day read credential after the user thought they had locked it down
 */
describe('session deletion is scoped by kind', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('deleteAllUserSessions defaults to browser only — a logout must not kill MCP tokens', async () => {
    await deleteAllUserSessions('u1');

    expect(calls[0]!.text).toContain('DELETE FROM user_sessions');
    expect(calls[0]!.values).toEqual(['u1', 'browser']);
  });

  it('deleteAllUserSessions can target another kind explicitly', async () => {
    await deleteAllUserSessions('u1', 'mcp');

    expect(calls[0]!.values).toEqual(['u1', 'mcp']);
  });

  it('deleteEveryUserSession is kind-agnostic — the credential-compromise sweep', async () => {
    await deleteEveryUserSession('u1');

    // Only the user id is bound: no kind predicate, so nothing can be left behind.
    expect(calls[0]!.values).toEqual(['u1']);
    expect(calls[0]!.text).not.toContain('kind');
  });

  it('getUserSessions filters by kind when asked, and does not when not', async () => {
    await getUserSessions('u1', 'mcp');
    expect(calls[0]!.values).toEqual(['u1', 'mcp']);
    expect(calls[0]!.text).toContain('kind');

    calls.length = 0;
    await getUserSessions('u1');
    expect(calls[0]!.values).toEqual(['u1']);
  });
});
