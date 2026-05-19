/**
 * Unit tests for sessionUtils — HMAC sign/verify round-trip + tampering
 * resistance. DB-facing paths (issueSession INSERT, verifySession SELECT,
 * revokeSession UPDATE) are covered by an integration test.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Stub sql — DB-path tests configure return values per-test below.
const mockSql = vi.fn();
vi.mock('@/lib/db-pool', () => ({
  sql: mockSql,
}));

// Set the secret before sessionUtils.ts reads it at import time.
const TEST_SECRET = 'test-only-secret-do-not-use-in-prod';
beforeAll(() => {
  process.env.MY_PORTAL_SESSION_SECRET = TEST_SECRET;
});

type MockReq = {
  headers: Record<string, string | undefined>;
  socket: { remoteAddress?: string };
};

function makeReq(cookie: string | null = null): MockReq {
  return {
    headers: {
      'user-agent': 'test-agent',
      ...(cookie ? { cookie } : {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

/**
 * Build a signed cookie value the same way issueSession does, without
 * going through the real function (which would call the DB).
 */
function signSessionPayload(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto
    .createHmac('sha256', TEST_SECRET)
    .update(encoded)
    .digest('hex');
  return `${encoded}.${signature}`;
}

async function loadSessionUtils() {
  // Re-import each time to let tests mutate process.env before loading.
  vi.resetModules();
  return await import('../sessionUtils');
}

describe('readSessionCookie', () => {
  const validPayload = {
    sessionId: 'sid-123',
    staffId: 'staff-456',
    staffName: 'Test Smoke',
    method: 'password',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  beforeEach(() => {
    process.env.MY_PORTAL_SESSION_SECRET = TEST_SECRET;
  });

  it('returns a valid session for a correctly-signed cookie', async () => {
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    const token = signSessionPayload(validPayload);
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);
    const session = readSessionCookie(req as never);
    expect(session?.sessionId).toBe('sid-123');
    expect(session?.method).toBe('password');
  });

  it('returns null when there is no cookie', async () => {
    const { readSessionCookie } = await loadSessionUtils();
    expect(readSessionCookie(makeReq(null) as never)).toBeNull();
  });

  it('returns null for a token missing the dot separator', async () => {
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    const req = makeReq(`${MY_SESSION_COOKIE}=no-separator-at-all`);
    expect(readSessionCookie(req as never)).toBeNull();
  });

  it('returns null for a tampered payload (flipped base64 char)', async () => {
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    const good = signSessionPayload(validPayload);
    // Flip one char in the payload half but keep the signature unchanged.
    const dotIndex = good.lastIndexOf('.');
    const badPayload = good.slice(0, 0) + 'A' + good.slice(1, dotIndex);
    const tampered = `${badPayload}.${good.slice(dotIndex + 1)}`;
    const req = makeReq(`${MY_SESSION_COOKIE}=${tampered}`);
    expect(readSessionCookie(req as never)).toBeNull();
  });

  it('returns null for a tampered signature (same length, wrong bytes)', async () => {
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    const good = signSessionPayload(validPayload);
    const dotIndex = good.lastIndexOf('.');
    const payloadPart = good.slice(0, dotIndex);
    const sigPart = good.slice(dotIndex + 1);
    // Flip the first hex char so length is unchanged.
    const flipped = (sigPart[0] === '0' ? '1' : '0') + sigPart.slice(1);
    const tampered = `${payloadPart}.${flipped}`;
    const req = makeReq(`${MY_SESSION_COOKIE}=${tampered}`);
    expect(readSessionCookie(req as never)).toBeNull();
  });

  it('returns null for a truncated signature (length mismatch)', async () => {
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    const good = signSessionPayload(validPayload);
    const dotIndex = good.lastIndexOf('.');
    const truncated = `${good.slice(0, dotIndex)}.${good.slice(dotIndex + 1, -10)}`;
    const req = makeReq(`${MY_SESSION_COOKIE}=${truncated}`);
    expect(readSessionCookie(req as never)).toBeNull();
  });

  it('returns null for an expired session (client-side check)', async () => {
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    const expired = { ...validPayload, expiresAt: new Date(Date.now() - 60_000).toISOString() };
    const token = signSessionPayload(expired);
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);
    expect(readSessionCookie(req as never)).toBeNull();
  });

  it('returns null for a valid signature over a schema-drifted payload', async () => {
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    // Missing `method` field — shape guard must reject even though HMAC passes.
    const shapeDrifted = {
      sessionId: 'sid-123',
      staffId: 'staff-456',
      staffName: 'Test',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const token = signSessionPayload(shapeDrifted);
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);
    expect(readSessionCookie(req as never)).toBeNull();
  });

  it('returns null for a signature built with a different secret', async () => {
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    const encoded = Buffer.from(JSON.stringify(validPayload)).toString('base64');
    const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update(encoded).digest('hex');
    const token = `${encoded}.${wrongSig}`;
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);
    expect(readSessionCookie(req as never)).toBeNull();
  });

  it('returns null when the secret is unset at verify time', async () => {
    delete process.env.MY_PORTAL_SESSION_SECRET;
    const { readSessionCookie, MY_SESSION_COOKIE } = await loadSessionUtils();
    const token = signSessionPayload(validPayload); // signed with TEST_SECRET
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);
    expect(readSessionCookie(req as never)).toBeNull();
    // Restore for subsequent tests.
    process.env.MY_PORTAL_SESSION_SECRET = TEST_SECRET;
  });
});

describe('verifySession', () => {
  const validPayload = {
    sessionId: 'sid-verify-1',
    staffId: 'staff-verify-1',
    staffName: 'Verify Smoke',
    method: 'password' as const,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  beforeEach(() => {
    process.env.MY_PORTAL_SESSION_SECRET = TEST_SECRET;
    vi.clearAllMocks();
  });

  it("returns reason='suspended' when staff.account_status is 'suspended'", async () => {
    const { verifySession, MY_SESSION_COOKIE } = await loadSessionUtils();
    const token = signSessionPayload(validPayload);
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);

    // Mock the JOIN'd DB response: valid session row, staff is suspended.
    mockSql.mockResolvedValueOnce([
      {
        revoked_at: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        account_status: 'suspended',
      },
    ]);

    const result = await verifySession(req as never);
    expect(result.valid).toBe(false);
    expect(result.session).toBeNull();
    expect(result.reason).toBe('suspended');
  });

  it("returns valid=true when staff.account_status is 'active'", async () => {
    const { verifySession, MY_SESSION_COOKIE } = await loadSessionUtils();
    const token = signSessionPayload(validPayload);
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);

    mockSql.mockResolvedValueOnce([
      {
        revoked_at: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        account_status: 'active',
      },
    ]);

    const result = await verifySession(req as never);
    expect(result.valid).toBe(true);
    expect(result.session).not.toBeNull();
    expect(result.reason).toBeUndefined();
  });

  it("returns reason='session_revoked' for a revoked session (regardless of account_status)", async () => {
    const { verifySession, MY_SESSION_COOKIE } = await loadSessionUtils();
    const token = signSessionPayload(validPayload);
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);

    mockSql.mockResolvedValueOnce([
      {
        revoked_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        account_status: 'active',
      },
    ]);

    const result = await verifySession(req as never);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('session_revoked');
  });

  it("returns reason='session_not_found' when DB row is missing (LEFT JOIN null staff safe)", async () => {
    const { verifySession, MY_SESSION_COOKIE } = await loadSessionUtils();
    const token = signSessionPayload(validPayload);
    const req = makeReq(`${MY_SESSION_COOKIE}=${token}`);

    // Empty result — session row doesn't exist.
    mockSql.mockResolvedValueOnce([]);

    const result = await verifySession(req as never);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('session_not_found');
  });
});
