import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeRoute, setTags } from './tags';

describe('sanitizeRoute', () => {
  it('strips query string from URL', () => {
    expect(sanitizeRoute('/api/foo?bar=1')).toBe('/api/foo');
  });

  it('returns path unchanged when no query string', () => {
    expect(sanitizeRoute('/api/foo')).toBe('/api/foo');
  });

  it('returns "unknown" for undefined', () => {
    expect(sanitizeRoute(undefined)).toBe('unknown');
  });

  it('returns "unknown" for empty string', () => {
    expect(sanitizeRoute('')).toBe('unknown');
  });
});

describe('setTags', () => {
  const originalEnv = process.env.SENTRY_ENABLED;

  beforeEach(() => {
    delete process.env.SENTRY_ENABLED;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SENTRY_ENABLED = originalEnv;
    } else {
      delete process.env.SENTRY_ENABLED;
    }
  });

  it('does not throw when SENTRY_ENABLED is unset', () => {
    expect(() => setTags({ requestId: 'r' })).not.toThrow();
  });
});
