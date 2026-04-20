/**
 * /my portal session utilities — HMAC cookie issuance and verification.
 *
 * Separate from the fleet portal's session layer:
 *   - different cookie name (ff_my_session vs ff_portal_session)
 *   - different signing secret (MY_PORTAL_SESSION_SECRET)
 *   - different path scope (/my vs /fleet)
 *   - 12-hour shifts vs 8-hour (field crews run longer)
 *   - DB row lives in attendance_auth_sessions, not fleet_portal_sessions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { parse, serialize } from 'cookie';
import crypto from 'crypto';
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { AttendanceSession, LoginMethod } from './types';

export const MY_SESSION_COOKIE = 'ff_my_session';
export const MY_SESSION_PATH = '/my';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12h
const SECRET = process.env.MY_PORTAL_SESSION_SECRET;

function getSecretOrThrow(): string {
  if (!SECRET) {
    throw new Error(
      'MY_PORTAL_SESSION_SECRET is not set — cannot sign /my portal session tokens.'
    );
  }
  return SECRET;
}

/** Build a signed token from a session payload. */
function signSession(session: AttendanceSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64');
  const signature = crypto
    .createHmac('sha256', getSecretOrThrow())
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

/** Runtime shape guard for a session payload — prevents `as AttendanceSession`
 *  from laundering a schema-drifted cookie into the type system. */
function isAttendanceSession(x: unknown): x is AttendanceSession {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.sessionId === 'string' && s.sessionId.length > 0 &&
    typeof s.staffId === 'string' && s.staffId.length > 0 &&
    typeof s.staffName === 'string' &&
    (s.method === 'pin' || s.method === 'password') &&
    typeof s.createdAt === 'string' &&
    typeof s.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(s.expiresAt))
  );
}

/** Parse a signed token back into a session payload. Returns null if invalid. */
function verifyToken(token: string): AttendanceSession | null {
  if (!SECRET) {
    // Misconfigured pod — every request will silently appear unauthenticated.
    // Log once per request rather than silently so ops notices immediately.
    log.error('[my-portal] MY_PORTAL_SESSION_SECRET is not set; all sessions will appear invalid');
    return null;
  }
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const payload = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    return isAttendanceSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Create session DB row + issue cookie. Returns the full session payload. */
export async function issueSession(args: {
  staffId: string;
  staffName: string;
  method: LoginMethod;
  req: NextApiRequest;
  res: NextApiResponse;
  deviceFingerprint?: string | null;
}): Promise<AttendanceSession> {
  const { staffId, staffName, method, req, res, deviceFingerprint } = args;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const sessionId = crypto.randomUUID();

  const session: AttendanceSession = {
    sessionId,
    staffId,
    staffName,
    method,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const token = signSession(session);
  const cookieHash = crypto.createHash('sha256').update(token).digest('hex');
  const ip =
    (req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()) ||
    req.socket.remoteAddress ||
    null;
  const userAgent = req.headers['user-agent'] ?? null;

  await sql`
    INSERT INTO attendance_auth_sessions
      (id, staff_id, cookie_hash, login_method, ip_address, user_agent,
       device_fingerprint, created_at, expires_at)
    VALUES
      (${sessionId}, ${staffId}, ${cookieHash}, ${method}, ${ip}, ${userAgent},
       ${deviceFingerprint ?? null}, ${now.toISOString()}, ${expiresAt.toISOString()})
  `;

  res.setHeader(
    'Set-Cookie',
    serialize(MY_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: MY_SESSION_PATH,
      maxAge: SESSION_DURATION_MS / 1000,
    })
  );

  return session;
}

/** Read the cookie off the request and verify its signature. No DB read. */
export function readSessionCookie(req: NextApiRequest): AttendanceSession | null {
  const token = parse(req.headers.cookie || '')[MY_SESSION_COOKIE];
  if (!token) return null;
  const session = verifyToken(token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
}

/** Verify session against the DB (checks revoked/expired). */
export async function verifySession(
  req: NextApiRequest
): Promise<{ valid: boolean; session: AttendanceSession | null; reason?: string }> {
  const session = readSessionCookie(req);
  if (!session) return { valid: false, session: null, reason: 'no_cookie_or_bad_signature' };

  const rows = await sql<{ revoked_at: string | null; expires_at: string }>`
    SELECT revoked_at, expires_at
    FROM attendance_auth_sessions
    WHERE id = ${session.sessionId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { valid: false, session: null, reason: 'session_not_found' };
  if (row.revoked_at) return { valid: false, session: null, reason: 'session_revoked' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { valid: false, session: null, reason: 'session_expired' };
  }

  return { valid: true, session };
}

/**
 * Revoke a session (DB + clear cookie). Safe to call without a valid session.
 *
 * Always clears the cookie FIRST. Logout must never leave a user
 * unexpectedly still-signed-in just because the DB couldn't record the
 * audit row — if the write fails, the session entry stays active in the
 * DB (will be reaped by `expires_at`) but the client no longer holds a
 * usable token.
 */
export async function revokeSession(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const session = readSessionCookie(req);

  // Clear the cookie first — this cannot fail and must always happen.
  res.setHeader(
    'Set-Cookie',
    serialize(MY_SESSION_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: MY_SESSION_PATH,
      maxAge: 0,
    })
  );

  if (!session) return;

  try {
    await sql`
      UPDATE attendance_auth_sessions
      SET revoked_at = NOW(), revoked_reason = 'logout'
      WHERE id = ${session.sessionId} AND revoked_at IS NULL
    `;
  } catch (err) {
    // Do not rethrow — the cookie is already cleared, user is effectively
    // logged out. The audit row will be swept by its expires_at.
    log.error('[my-logout] failed to mark session revoked in DB', {
      sessionId: session.sessionId,
      staffId: session.staffId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
