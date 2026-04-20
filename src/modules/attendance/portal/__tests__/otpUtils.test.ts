/**
 * Unit tests for otpUtils — pure helpers + fetch-level WA send.
 *
 * DB-touching helpers (upsertPendingOtp, findPendingOtpByPhone,
 * commitPinAndClearOtp, bumpOtpAttempts, invalidatePendingOtp) use the
 * Proxy-backed sql mock to assert on the SQL shape rather than round-trip
 * through a real Postgres. A separate integration test will exercise them
 * end-to-end once the Velocity test harness is provisioned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The sql template is consumed both as `sql<T>\`...\`` and `sql\`...\``. We
// want to (a) spy on the invocations and (b) let each test set the next
// result. Using a queue is clearer than building a full Proxy per test.
// Everything referenced by the vi.mock factory must be declared in
// vi.hoisted() because vi.mock is hoisted above module-level lets/consts.
const { sqlResults, sqlCalls, sqlFn } = vi.hoisted(() => {
  const results: Array<unknown[]> = [];
  const calls: Array<{ strings: readonly string[]; values: unknown[] }> = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: Array.from(strings), values });
    const next = results.shift();
    return Promise.resolve(next ?? []);
  });
  return { sqlResults: results, sqlCalls: calls, sqlFn: fn };
});
vi.mock('@/lib/db-pool', () => ({ sql: sqlFn }));

import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  bumpOtpAttempts,
  commitPinAndClearOtp,
  findPendingOtpByPhone,
  generateOtp,
  hashOtp,
  invalidatePendingOtp,
  sendOtpViaWhatsApp,
  upsertPendingOtp,
  verifyOtp,
} from '../otpUtils';

beforeEach(() => {
  sqlResults.length = 0;
  sqlCalls.length = 0;
  sqlFn.mockClear();
});

describe('generateOtp', () => {
  it('always returns exactly 6 digits', () => {
    for (let i = 0; i < 100; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      expect(otp.length).toBe(OTP_LENGTH);
    }
  });

  it('preserves leading zeros across a statistically-significant sample', () => {
    // Over 5000 draws from [0, 10^6) the expected count of leading-zero OTPs
    // is ~500 (10%). If padStart was removed — e.g. `n.toString()` without
    // the `.padStart(6, '0')` — outputs below 100000 would collapse to <6
    // characters and fail the regex. The "always 6 digits" test above is
    // the first gate; this one specifically asserts that some of those 6-
    // digit outputs do in fact start with '0', proving padStart is engaged.
    let leadingZero = 0;
    for (let i = 0; i < 5000; i++) {
      if (generateOtp().startsWith('0')) leadingZero++;
    }
    // Statistical floor: p(< 100 hits) with mean 500 and sd ~21 is effectively
    // zero. If this ever fails in CI it's a real regression.
    expect(leadingZero).toBeGreaterThan(100);
  });

  it('returns a non-negligibly large set of distinct values', () => {
    // 100 draws from 10^6 should yield close to 100 unique values.
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateOtp());
    expect(seen.size).toBeGreaterThan(90);
  });
});

describe('hashOtp / verifyOtp', () => {
  it('round-trips a correct OTP', async () => {
    const hash = await hashOtp('123456');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await verifyOtp('123456', hash)).toBe(true);
  });

  it('rejects the wrong OTP', async () => {
    const hash = await hashOtp('123456');
    expect(await verifyOtp('654321', hash)).toBe(false);
  });

  it('throws on non-6-digit input', async () => {
    await expect(hashOtp('12345')).rejects.toThrow(/6 digits/);
    await expect(hashOtp('abcdef')).rejects.toThrow(/6 digits/);
    await expect(hashOtp('1234567')).rejects.toThrow(/6 digits/);
  });

  it('returns false (not throws) on a structurally invalid hash', async () => {
    expect(await verifyOtp('123456', 'not-a-real-bcrypt-hash')).toBe(false);
  });
});

describe('upsertPendingOtp', () => {
  it('issues a fresh OTP when no prior pending row exists', async () => {
    sqlResults.push([]); // SELECT: no existing row
    sqlResults.push([]); // INSERT ... ON CONFLICT

    const res = await upsertPendingOtp({
      staffId: 'staff-1',
      otpHash: 'hash-abc',
    });

    expect(res.sent).toBe(true);
    expect(res.cooldownMs).toBe(0);
    expect(sqlCalls).toHaveLength(2);
  });

  it('swallows resend within the cooldown window', async () => {
    const now = new Date('2026-04-20T12:00:00Z');
    // Existing pending row requested 30s ago, still valid.
    sqlResults.push([
      {
        pending_otp_requested_at: new Date(now.getTime() - 30_000).toISOString(),
        pending_otp_expires_at: new Date(now.getTime() + 9 * 60_000).toISOString(),
      },
    ]);

    const res = await upsertPendingOtp({
      staffId: 'staff-1',
      otpHash: 'hash-abc',
      now,
    });

    expect(res.sent).toBe(false);
    expect(res.cooldownMs).toBeGreaterThan(0);
    expect(res.cooldownMs).toBeLessThanOrEqual(OTP_RESEND_COOLDOWN_MS);
    // Must NOT have run the INSERT — only the SELECT.
    expect(sqlCalls).toHaveLength(1);
  });

  it('cooldown boundary — blocks at 1ms before the threshold, allows at the threshold', async () => {
    const now = new Date('2026-04-20T12:00:00Z');

    // Last request was (cooldown - 1)ms ago — still inside the window.
    sqlResults.push([
      {
        pending_otp_requested_at: new Date(
          now.getTime() - (OTP_RESEND_COOLDOWN_MS - 1),
        ).toISOString(),
        pending_otp_expires_at: new Date(now.getTime() + 9 * 60_000).toISOString(),
      },
    ]);
    const blocked = await upsertPendingOtp({
      staffId: 'staff-1',
      otpHash: 'hash-abc',
      now,
    });
    expect(blocked.sent).toBe(false);

    // Next request at exactly cooldown ms elapsed — guard is `sinceLast <
    // cooldown`, so equality should allow the resend.
    sqlResults.push([
      {
        pending_otp_requested_at: new Date(
          now.getTime() - OTP_RESEND_COOLDOWN_MS,
        ).toISOString(),
        pending_otp_expires_at: new Date(now.getTime() + 9 * 60_000).toISOString(),
      },
    ]);
    sqlResults.push([]); // INSERT succeeds
    const allowed = await upsertPendingOtp({
      staffId: 'staff-1',
      otpHash: 'hash-abc',
      now,
    });
    expect(allowed.sent).toBe(true);
  });

  it('issues a fresh OTP when the prior OTP has expired', async () => {
    const now = new Date('2026-04-20T12:00:00Z');
    // Requested 20min ago, expired 10min ago.
    sqlResults.push([
      {
        pending_otp_requested_at: new Date(now.getTime() - 20 * 60_000).toISOString(),
        pending_otp_expires_at: new Date(now.getTime() - 10 * 60_000).toISOString(),
      },
    ]);
    sqlResults.push([]);

    const res = await upsertPendingOtp({
      staffId: 'staff-1',
      otpHash: 'hash-abc',
      now,
    });

    expect(res.sent).toBe(true);
    expect(sqlCalls).toHaveLength(2);
  });

  it('issues a fresh OTP when last request was outside the cooldown', async () => {
    const now = new Date('2026-04-20T12:00:00Z');
    // Last request 2 minutes ago, still valid (10min TTL).
    sqlResults.push([
      {
        pending_otp_requested_at: new Date(now.getTime() - 2 * 60_000).toISOString(),
        pending_otp_expires_at: new Date(now.getTime() + 8 * 60_000).toISOString(),
      },
    ]);
    sqlResults.push([]);

    const res = await upsertPendingOtp({
      staffId: 'staff-1',
      otpHash: 'hash-abc',
      now,
    });

    expect(res.sent).toBe(true);
  });

  it('resends when prior row has malformed timestamps (fail-open on next write)', async () => {
    sqlResults.push([
      {
        pending_otp_requested_at: 'not-a-date',
        pending_otp_expires_at: 'also-not-a-date',
      },
    ]);
    sqlResults.push([]);
    const res = await upsertPendingOtp({
      staffId: 'staff-1',
      otpHash: 'hash-abc',
    });
    expect(res.sent).toBe(true);
  });
});

describe('findPendingOtpByPhone', () => {
  it('returns null for unparseable phone without touching the DB', async () => {
    const res = await findPendingOtpByPhone('not-a-phone');
    expect(res).toBeNull();
    expect(sqlCalls).toHaveLength(0);
  });

  it('returns the row when the phone matches', async () => {
    const row = {
      staff_id: 'staff-1',
      pending_otp_hash: 'hash',
      pending_otp_expires_at: new Date().toISOString(),
      pending_otp_attempts: 1,
      phone_verified_at: null,
      pin_hash: null,
    };
    sqlResults.push([row]);

    const res = await findPendingOtpByPhone('0821234567');
    expect(res).toEqual(row);
    // Should have searched for e164, subscriber, and trunk forms.
    expect(sqlCalls).toHaveLength(1);
    const call = sqlCalls[0]!;
    expect(call.values).toContain('27821234567');
    expect(call.values).toContain('821234567');
    expect(call.values).toContain('0821234567');
  });
});

describe('bumpOtpAttempts / invalidatePendingOtp', () => {
  it('bumpOtpAttempts runs an UPDATE', async () => {
    sqlResults.push([]);
    await bumpOtpAttempts('staff-1');
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0]!.values).toContain('staff-1');
  });

  it('invalidatePendingOtp runs an UPDATE with NULL clears', async () => {
    sqlResults.push([]);
    await invalidatePendingOtp('staff-1');
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0]!.strings.join('')).toMatch(/pending_otp_hash\s+=\s+NULL/);
  });

  it('bumpOtpAttempts never throws on a DB failure', async () => {
    sqlFn.mockRejectedValueOnce(new Error('boom'));
    await expect(bumpOtpAttempts('staff-1')).resolves.toBeUndefined();
  });

  it('invalidatePendingOtp never throws on a DB failure', async () => {
    sqlFn.mockRejectedValueOnce(new Error('boom'));
    await expect(invalidatePendingOtp('staff-1')).resolves.toBeUndefined();
  });
});

describe('commitPinAndClearOtp', () => {
  it('writes the new PIN, clears the pending OTP, and verifies the phone', async () => {
    sqlResults.push([]);
    await commitPinAndClearOtp({
      staffId: 'staff-1',
      pinHash: 'new-pin-hash',
      deviceFingerprint: 'dev-1',
    });
    expect(sqlCalls).toHaveLength(1);
    const { strings, values } = sqlCalls[0]!;
    expect(values).toContain('new-pin-hash');
    expect(values).toContain('dev-1');
    expect(values).toContain('staff-1');
    expect(strings.join('')).toMatch(/phone_verified_at\s+=\s+COALESCE/);
    expect(strings.join('')).toMatch(/pending_otp_hash\s+=\s+NULL/);
  });

  it('allows null device fingerprint (COALESCE preserves existing)', async () => {
    sqlResults.push([]);
    await commitPinAndClearOtp({
      staffId: 'staff-1',
      pinHash: 'new-pin-hash',
      deviceFingerprint: null,
    });
    const { values } = sqlCalls[0]!;
    expect(values).toContain(null);
  });
});

describe('sendOtpViaWhatsApp', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs to the configured WA sender with chatId + message', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => 'ok',
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await sendOtpViaWhatsApp({
      phone: '+27821234567',
      otp: '123456',
      staffName: 'Test Smoke',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as { chatId: string; message: string };
    expect(body.chatId).toBe('27821234567@s.whatsapp.net');
    expect(body.message).toContain('123456');
    expect(body.message).toContain('Test Smoke');
    expect(body.message).toContain(String(Math.round(OTP_TTL_MS / 60_000)));
  });

  it('omits the name segment when staffName is nullish', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => 'ok',
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await sendOtpViaWhatsApp({ phone: '+27821234567', otp: '123456', staffName: null });
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as { message: string };
    // "Hi —" (no name) rather than "Hi, Name —"
    expect(body.message.startsWith('Hi —')).toBe(true);
  });

  it('throws on a non-2xx response so the caller can log it', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => 'Bad Gateway',
    })) as unknown as typeof fetch;

    await expect(
      sendOtpViaWhatsApp({ phone: '+27821234567', otp: '123456' })
    ).rejects.toThrow(/502/);
  });
});

describe('constants', () => {
  it('cooldown is shorter than TTL (otherwise resends would always be blocked)', () => {
    expect(OTP_RESEND_COOLDOWN_MS).toBeLessThan(OTP_TTL_MS);
  });

  it('max attempts is > 1 (otherwise one typo burns the OTP)', () => {
    expect(OTP_MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});
