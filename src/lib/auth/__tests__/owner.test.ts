import { beforeEach, describe, expect, it } from 'vitest';
import { isOwner, ownerEmails } from '../owner';

describe('isOwner', () => {
  beforeEach(() => {
    process.env.FF_OWNER_EMAILS = 'hein@velocityfibre.co.za';
  });

  it('matches the configured owner, case-insensitively and trimmed', () => {
    expect(isOwner({ email: 'hein@velocityfibre.co.za' })).toBe(true);
    expect(isOwner({ email: 'HEIN@VelocityFibre.CO.ZA' })).toBe(true);
    expect(isOwner({ email: '  hein@velocityfibre.co.za  ' })).toBe(true);
  });

  it('rejects everyone else and every empty shape', () => {
    expect(isOwner({ email: 'lew@velocityfibre.co.za' })).toBe(false);
    expect(isOwner({ email: '' })).toBe(false);
    expect(isOwner({ email: null })).toBe(false);
    expect(isOwner(null)).toBe(false);
    expect(isOwner(undefined)).toBe(false);
  });

  it('supports a comma-separated list and is read at call time', () => {
    process.env.FF_OWNER_EMAILS = 'a@x.co, b@x.co';
    expect(ownerEmails()).toEqual(['a@x.co', 'b@x.co']);
    expect(isOwner({ email: 'b@x.co' })).toBe(true);
  });

  it('falls back to the historical owner when the env var is unset', () => {
    delete process.env.FF_OWNER_EMAILS;
    expect(isOwner({ email: 'hein@velocityfibre.co.za' })).toBe(true);
  });
});
