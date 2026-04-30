/**
 * Unit tests for credentialUtils — the SQL-shape contracts that login.ts
 * relies on. We mock the tagged-template `sql` so we can assert what gets
 * sent to Postgres without standing up a real DB.
 *
 * Most of credentialUtils' branching is exercised at the handler layer
 * (my-login.test.ts). What this file pins down:
 *
 *   1. findAuthRowByEmail joins `users` and returns users.password as
 *      `password_hash` — the migration away from `attendance_credentials.password_hash`.
 *   2. recordFailedAttempt / recordSuccessfulLogin are UPSERTs (so a staff
 *      member with no pre-existing credentials row still accumulates lockout
 *      and gets reset on success).
 *   3. Both UPDATEs are fail-safe (never throw on DB error).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/logger', () => ({
  log: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Import AFTER the mock is registered.
import {
  findAuthRowByEmail,
  recordFailedAttempt,
  recordSuccessfulLogin,
} from '@/modules/attendance/portal/credentialUtils';

/** Reconstruct the literal SQL string from a tagged-template call so we can
 *  pattern-match against it without depending on whitespace. */
function sqlString(stringsArg: unknown): string {
  const strings = stringsArg as TemplateStringsArray;
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findAuthRowByEmail', () => {
  it('sources password_hash from users.password (not attendance_credentials)', async () => {
    mocks.sql.mockResolvedValue([]);

    await findAuthRowByEmail('smoke@test.local');

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const call = mocks.sql.mock.calls[0];
    const query = sqlString(call[0]);

    // Aliases users.password -> password_hash so callers don't change.
    expect(query).toMatch(/u\.password\s+AS\s+password_hash/i);
    // Drives the lookup off the users table, not attendance_credentials.
    expect(query).toMatch(/FROM users u/i);
    // Joins staff strictly via user_id — no email-fallback OR branch
    // (closes a small timing-oracle asymmetry).
    expect(query).toMatch(/JOIN staff s ON s\.user_id = u\.id/i);
    // attendance_credentials is LEFT JOIN — only used for lockout state.
    expect(query).toMatch(/LEFT JOIN attendance_credentials/i);
    // Active filters on both sides.
    expect(query).toMatch(/u\.is_active\s*=\s*true/i);
    expect(query).toMatch(/LOWER\(s\.status\)\s*=\s*'active'/i);
    // Email match is case-insensitive on users.email.
    expect(query).toMatch(/LOWER\(u\.email\)\s*=\s*LOWER/i);
    // Deterministic ORDER BY before LIMIT 1 — staff.user_id is not unique,
    // so without ordering the chosen row would be non-deterministic.
    expect(query).toMatch(/ORDER BY s\.id/i);
  });

  it('LEFT-JOIN null path: staff with no credentials row returns failed_attempts: 0', async () => {
    // Smoke that the COALESCE(c.failed_attempts, 0) keeps lockoutMsRemaining
    // and the failed-attempts arithmetic safe when no credentials row exists.
    const row = {
      staff_id: 'fresh-staff',
      pin_hash: null,
      password_hash: '$2b$12$hash',
      failed_attempts: 0, // COALESCE result when c.failed_attempts is NULL
      locked_until: null,
      staff_status: 'active',
      staff_name: 'Fresh',
      staff_phone: null,
      staff_email: 'fresh@test.local',
    };
    mocks.sql.mockResolvedValue([row]);
    const result = await findAuthRowByEmail('fresh@test.local');
    expect(result).not.toBeNull();
    expect(result!.failed_attempts).toBe(0);
    expect(result!.locked_until).toBeNull();
  });

  it('returns null when no row matches', async () => {
    mocks.sql.mockResolvedValue([]);
    const result = await findAuthRowByEmail('nobody@test.local');
    expect(result).toBeNull();
  });

  it('returns the first row when one matches', async () => {
    const row = {
      staff_id: 'abc',
      pin_hash: null,
      password_hash: '$2b$12$realhash',
      failed_attempts: 0,
      locked_until: null,
      staff_status: 'active',
      staff_name: 'Test',
      staff_phone: null,
      staff_email: 'smoke@test.local',
    };
    mocks.sql.mockResolvedValue([row]);
    const result = await findAuthRowByEmail('smoke@test.local');
    expect(result).toEqual(row);
  });
});

describe('recordFailedAttempt', () => {
  it('issues an UPSERT (so staff with no credentials row still get lockout state)', async () => {
    mocks.sql.mockResolvedValue([]);

    await recordFailedAttempt('staff-123');

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const query = sqlString(mocks.sql.mock.calls[0][0]);

    expect(query).toMatch(/INSERT INTO attendance_credentials/i);
    // Verify the column list contains all required columns (order-independent
    // so a benign reorder doesn't false-fail the test). `created_at` is set
    // explicitly to defend against future DDL changes that drop the column
    // DEFAULT.
    expect(query).toMatch(/\bstaff_id\b/);
    expect(query).toMatch(/\bfailed_attempts\b/);
    expect(query).toMatch(/\blocked_until\b/);
    expect(query).toMatch(/\bcreated_at\b/);
    expect(query).toMatch(/\bupdated_at\b/);
    expect(query).toMatch(/ON CONFLICT \(staff_id\) DO UPDATE/i);
    expect(query).toMatch(/failed_attempts\s*=\s*attendance_credentials\.failed_attempts\s*\+\s*1/i);
  });

  it('does not throw when the DB fails, and logs the error (fail-safe contract)', async () => {
    mocks.sql.mockRejectedValue(new Error('connection refused'));
    await expect(recordFailedAttempt('staff-123')).resolves.toBeUndefined();
    // Empty catch is forbidden by Zero Tolerance; assert the swallow is logged.
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe('recordSuccessfulLogin', () => {
  it('issues an UPSERT that zeroes failed_attempts and clears lockout', async () => {
    mocks.sql.mockResolvedValue([]);

    await recordSuccessfulLogin('staff-123');

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const query = sqlString(mocks.sql.mock.calls[0][0]);

    expect(query).toMatch(/INSERT INTO attendance_credentials/i);
    expect(query).toMatch(/\bstaff_id\b/);
    expect(query).toMatch(/\bfailed_attempts\b/);
    expect(query).toMatch(/\blocked_until\b/);
    expect(query).toMatch(/\bcreated_at\b/);
    expect(query).toMatch(/\bupdated_at\b/);
    expect(query).toMatch(/ON CONFLICT \(staff_id\) DO UPDATE/i);
    expect(query).toMatch(/failed_attempts\s*=\s*0/i);
    expect(query).toMatch(/locked_until\s*=\s*NULL/i);
  });

  it('does not throw when the DB fails, and logs the error (fail-safe contract)', async () => {
    mocks.sql.mockRejectedValue(new Error('connection refused'));
    await expect(recordSuccessfulLogin('staff-123')).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalled();
  });
});
