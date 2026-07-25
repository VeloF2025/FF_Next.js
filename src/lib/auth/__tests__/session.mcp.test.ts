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

import { createSession, setSessionTokenHash } from '../session';

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
