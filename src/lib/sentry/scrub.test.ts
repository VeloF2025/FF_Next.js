// src/lib/sentry/scrub.test.ts
import { describe, it, expect } from 'vitest';
import { scrubEvent } from './scrub';
import type { Event } from '@sentry/nextjs';

describe('scrubEvent', () => {
  // Test 1: Returns null when event is null
  it('returns null when event is null', () => {
    expect(scrubEvent(null)).toBeNull();
  });

  // Test 2: Redacts sensitive keys in request.data
  it('redacts password, bank, iban, account_number, otp, secret, token keys', () => {
    const event: Event = {
      request: {
        data: {
          password: 'p',
          bank_account_number: 'b',
          otp: '123',
          secret: 'x',
          api_token: 't',
        },
      },
    };
    const result = scrubEvent(event);
    const data = result!.request!.data as Record<string, unknown>;
    expect(data.password).toBe('[REDACTED]');
    expect(data.bank_account_number).toBe('[REDACTED]');
    expect(data.otp).toBe('[REDACTED]');
    expect(data.secret).toBe('[REDACTED]');
    expect(data.api_token).toBe('[REDACTED]');
  });

  // Test 3: Leaves non-sensitive keys alone
  it('leaves non-sensitive keys unchanged', () => {
    const event: Event = {
      request: {
        data: {
          username: 'alice',
          amount: 100,
          description: 'test payment',
        },
      },
    };
    const result = scrubEvent(event);
    const data = result!.request!.data as Record<string, unknown>;
    expect(data.username).toBe('alice');
    expect(data.amount).toBe(100);
    expect(data.description).toBe('test payment');
  });

  // Test 4: Handles circular references without throwing
  it('handles circular refs without throwing (emits [CIRCULAR])', () => {
    const circular: Record<string, unknown> = { name: 'test' };
    circular.self = circular;
    const event: Event = {
      request: {
        data: circular,
      },
    };
    expect(() => scrubEvent(event)).not.toThrow();
    const result = scrubEvent(event);
    const data = result!.request!.data as Record<string, unknown>;
    expect(data.self).toBe('[CIRCULAR]');
  });

  // Test 5: URL-decodes query-string keys before matching
  it('URL-decodes query-string keys before matching sensitive patterns', () => {
    const event: Event = {
      request: {
        query_string: 'user%5Fpassword=foo&normal=bar',
      },
    };
    const result = scrubEvent(event);
    // user_password decoded contains 'pass' so should be redacted
    expect(result!.request!.query_string).toContain('[REDACTED]');
    // normal key should be preserved
    expect(result!.request!.query_string).toContain('normal=bar');
  });

  // Test 6: Drops cookie, authorization, x-csrf-token headers (case-insensitive)
  it('drops cookie, authorization, x-csrf-token headers (case-insensitive)', () => {
    const event: Event = {
      request: {
        headers: {
          Cookie: 'session=abc',
          Authorization: 'Bearer token123',
          'X-CSRF-Token': 'csrf-value',
          'Content-Type': 'application/json',
        },
      },
    };
    const result = scrubEvent(event);
    const headers = result!.request!.headers as Record<string, string>;
    expect(headers['Cookie']).toBeUndefined();
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['X-CSRF-Token']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  // Test 7: Hashes email local part
  it('hashes email local part — test@example.com → <8hex>@example.com', () => {
    const event: Event = {
      request: {
        data: {
          email: 'test@example.com',
        },
      },
    };
    const result = scrubEvent(event);
    const data = result!.request!.data as Record<string, unknown>;
    const hashed = data.email as string;
    expect(hashed).toMatch(/^[0-9a-f]{8}@example\.com$/);
    expect(hashed).not.toBe('test@example.com');
  });

  // Test 8: Deterministic hash — same input → same output across two calls
  it('produces deterministic hash for same email input', () => {
    const makeEvent = (): Event => ({
      request: {
        data: { email: 'user@domain.com' },
      },
    });
    const result1 = scrubEvent(makeEvent());
    const result2 = scrubEvent(makeEvent());
    const data1 = result1!.request!.data as Record<string, unknown>;
    const data2 = result2!.request!.data as Record<string, unknown>;
    expect(data1.email).toBe(data2.email);
  });

  // Test 9: Preserves array structure inside request.data
  it('preserves array structure inside request.data', () => {
    const event: Event = {
      request: {
        data: {
          items: ['apple', 'banana', 'cherry'],
          nested: [{ name: 'safe', password: 'secret' }],
        },
      },
    };
    const result = scrubEvent(event);
    const data = result!.request!.data as Record<string, unknown>;
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items).toEqual(['apple', 'banana', 'cherry']);
    expect(Array.isArray(data.nested)).toBe(true);
    const nestedArr = data.nested as Array<Record<string, unknown>>;
    expect(nestedArr[0].name).toBe('safe');
    expect(nestedArr[0].password).toBe('[REDACTED]');
  });

  // Test 10: Returns event unchanged when no request field present
  it('returns event unchanged when no request field present', () => {
    const event: Event = {
      message: 'something happened',
      level: 'info',
    };
    const result = scrubEvent(event);
    expect(result).toBe(event);
    expect(result!.message).toBe('something happened');
  });
});
