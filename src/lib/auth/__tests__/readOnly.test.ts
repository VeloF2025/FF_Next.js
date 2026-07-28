import { describe, expect, it } from 'vitest';
import { isReadOnlyViolation } from '../readOnly';
import type { AuthUser, SessionKind } from '../types';

const user = (kind?: SessionKind): AuthUser =>
  ({
    id: 'u1',
    userId: 'u1',
    email: 'a@x.co',
    firstName: 'A',
    lastName: 'B',
    name: 'A B',
    role: 'viewer',
    permissions: [],
    isActive: true,
    sessionKind: kind,
  }) as AuthUser;

describe('isReadOnlyViolation', () => {
  it('allows safe methods on an mcp session', () => {
    for (const m of ['GET', 'get', 'HEAD', 'OPTIONS']) {
      expect(isReadOnlyViolation(user('mcp'), m)).toBe(false);
    }
  });

  it('blocks every mutating method on an mcp session', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(isReadOnlyViolation(user('mcp'), m)).toBe(true);
    }
  });

  it('never blocks a browser session or a user with no session kind', () => {
    expect(isReadOnlyViolation(user('browser'), 'DELETE')).toBe(false);
    expect(isReadOnlyViolation(user(undefined), 'POST')).toBe(false);
  });

  it('treats a missing method as GET', () => {
    expect(isReadOnlyViolation(user('mcp'), undefined)).toBe(false);
  });

  it('fails closed on an unrecognised method', () => {
    expect(isReadOnlyViolation(user('mcp'), 'TRACE')).toBe(true);
  });
});
