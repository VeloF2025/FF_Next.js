/**
 * Unit tests for credentialUtils — pure functions only.
 *
 * DB-facing helpers (findAuthRowByPhone/Email, recordFailedAttempt,
 * recordSuccessfulLogin) need integration tests against a real Postgres
 * to be meaningful. Those live alongside in a separate *.integration.test.ts
 * (to be added in a follow-up once the test infra is provisioned on
 * Velocity).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Stub the sql import so importing credentialUtils.ts doesn't require a DB.
vi.mock('@/lib/db-pool', () => ({
  sql: vi.fn(),
}));

import {
  normaliseSaPhone,
  lockoutMsRemaining,
  hashPin,
  hashPassword,
  verifyCredential,
  consumeTimingPadding,
} from '../credentialUtils';

describe('normaliseSaPhone', () => {
  const cases: Array<[string, string | null, string]> = [
    ['+27821234567',      '+27821234567', 'E.164 exact'],
    ['27821234567',       '+27821234567', 'E.164 without leading +'],
    ['0821234567',        '+27821234567', 'local 10-digit with leading 0'],
    ['082 123 4567',      '+27821234567', 'local 10-digit with spaces'],
    ['082-123-4567',      '+27821234567', 'local 10-digit with dashes'],
    ['(082) 123 4567',    '+27821234567', 'local 10-digit with parens'],
    ['+27 82 123 4567',   '+27821234567', 'E.164 with spaces'],
    ['+27-82-123-4567',   '+27821234567', 'E.164 with dashes'],
    ['821234567',         '+27821234567', '9-digit subscriber-only'],
    ['270821234567',      '+27821234567', 'international with trunk zero (270)'],
    // Failure modes:
    ['',                  null,           'empty'],
    ['123',               null,           'too short'],
    ['082123456',         null,           '9 digits with leading 0 (malformed)'],
    ['abc',               null,           'non-numeric'],
    ['1234567890123456',  null,           'too long'],
  ];

  it.each(cases)('%s → %s (%s)', (input, expected, _label) => {
    expect(normaliseSaPhone(input)).toBe(expected);
  });

  it('rejects non-string inputs', () => {
    // @ts-expect-error testing runtime guard against non-string input
    expect(normaliseSaPhone(undefined)).toBeNull();
    // @ts-expect-error testing runtime guard against non-string input
    expect(normaliseSaPhone(null)).toBeNull();
    // @ts-expect-error testing runtime guard against non-string input
    expect(normaliseSaPhone(12345)).toBeNull();
  });
});

describe('lockoutMsRemaining', () => {
  it('returns 0 when locked_until is null', () => {
    expect(lockoutMsRemaining({ locked_until: null })).toBe(0);
  });

  it('returns 0 when locked_until is in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(lockoutMsRemaining({ locked_until: past })).toBe(0);
  });

  it('returns positive ms when locked_until is in the future', () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    const ms = lockoutMsRemaining({ locked_until: future });
    expect(ms).toBeGreaterThan(4 * 60_000);
    expect(ms).toBeLessThanOrEqual(5 * 60_000);
  });

  it('returns Infinity (fail-closed) for an unparseable value', () => {
    // Cast through unknown because the column is typed string|null but
    // postgres or a corrupted row could present something else at runtime.
    const badRow = { locked_until: 'not-a-date-at-all' as unknown as string };
    expect(lockoutMsRemaining(badRow)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('hashPin', () => {
  it('produces a bcrypt hash for a valid 6-digit PIN', async () => {
    const hash = await hashPin('123456');
    expect(hash.startsWith('$2')).toBe(true); // $2a$ or $2b$
    expect(hash.length).toBeGreaterThan(50);
  });

  it('rejects non-6-digit PINs', async () => {
    await expect(hashPin('12345')).rejects.toThrow(/6 digits/);
    await expect(hashPin('1234567')).rejects.toThrow(/6 digits/);
    await expect(hashPin('abc123')).rejects.toThrow(/6 digits/);
    await expect(hashPin('')).rejects.toThrow(/6 digits/);
  });

  it('produces verifiable hashes', async () => {
    const hash = await hashPin('654321');
    expect(await verifyCredential('654321', hash)).toBe(true);
    expect(await verifyCredential('123456', hash)).toBe(false);
  });
});

describe('hashPassword + verifyCredential', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('SomeTestPass!');
    expect(await verifyCredential('SomeTestPass!', hash)).toBe(true);
    expect(await verifyCredential('WrongPass!', hash)).toBe(false);
  });

  it('returns false (not throws) on a structurally-invalid hash', async () => {
    // A logged error is expected here, not a thrown exception.
    const result = await verifyCredential('anything', 'not-a-bcrypt-hash');
    expect(result).toBe(false);
  });
});

describe('consumeTimingPadding', () => {
  it('resolves without throwing regardless of input', async () => {
    await expect(consumeTimingPadding('')).resolves.toBeUndefined();
    await expect(consumeTimingPadding('abc')).resolves.toBeUndefined();
    await expect(consumeTimingPadding('x'.repeat(100))).resolves.toBeUndefined();
  });

  it('takes measurable time (bcrypt compare, not a no-op)', async () => {
    const start = Date.now();
    await consumeTimingPadding('timing-check');
    const elapsed = Date.now() - start;
    // bcrypt at cost 12 takes ~100–500 ms. 30 ms floor is very conservative —
    // if padding ever becomes a no-op (e.g. someone replaces DUMMY_HASH with
    // something bcrypt rejects instantly), this catches it.
    expect(elapsed).toBeGreaterThan(30);
  });
});
