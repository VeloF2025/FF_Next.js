/**
 * Session Management
 * Database-backed session handling for token revocation and multi-device support
 */

import { neon } from '@/lib/db-neon';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import type { Session, SessionKind } from './types';

const sql = neon(process.env.DATABASE_URL!);

// Session expiry (30 days)
const SESSION_EXPIRY_DAYS = 30;

/**
 * Create a hash of the token for storage
 * We don't store the actual token, just a hash for comparison
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface CreateSessionOptions {
  /** Defaults to 'browser'. */
  kind?: SessionKind;
  /** Overrides SESSION_EXPIRY_DAYS for this row. */
  expiryDays?: number;
  /** Human label shown in the user's connections list. MCP sessions only. */
  label?: string;
}

/**
 * Create a new session for a user.
 *
 * Callers pass `''` for `token` and then call `setSessionTokenHash` once the JWT has
 * been signed — the JWT embeds the session id, so the row must exist first.
 */
export async function createSession(
  userId: string,
  token: string,
  ipAddress?: string,
  userAgent?: string,
  options?: CreateSessionOptions
): Promise<Session> {
  const sessionId = uuidv4();
  const tokenHash = hashToken(token);
  const kind: SessionKind = options?.kind ?? 'browser';
  const expiryDays = options?.expiryDays ?? SESSION_EXPIRY_DAYS;
  const label = options?.label ?? null;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  await sql`
    INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent, kind, label)
    VALUES (${sessionId}, ${userId}, ${tokenHash}, ${expiresAt.toISOString()}, ${ipAddress || null}, ${userAgent || null}, ${kind}, ${label})
  `;

  return {
    id: sessionId,
    userId,
    tokenHash,
    expiresAt,
    createdAt: new Date(),
    ipAddress,
    userAgent,
    kind,
    label: options?.label,
  };
}

/**
 * Bind a signed JWT to its session row.
 *
 * Currently used ONLY by the MCP mint. pages/api/auth/login.ts and setup-password.ts
 * still run their own inline `UPDATE user_sessions SET token_hash = ...`; wiring them to
 * this helper is deliberately deferred to a later PR in this stack, so that a change to
 * the login path is reviewed on its own rather than riding along with new functionality.
 *
 * Stated in the present tense because an earlier revision of this comment claimed the
 * extraction had already happened, which a reader of this file alone would have believed.
 */
export async function setSessionTokenHash(sessionId: string, token: string): Promise<void> {
  await sql`
    UPDATE user_sessions
    SET token_hash = encode(sha256(${token}::bytea), 'hex')
    WHERE id = ${sessionId}
  `;
}

/**
 * Create an impersonation session for a target user.
 * Sessions expire in 1 hour and are flagged with is_impersonation=true.
 * Follows the same pattern as createSession.
 */
export async function createImpersonationSession(
  targetUserId: string,
  token: string,
  impersonatedBy: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Session> {
  const sessionId = uuidv4();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await sql`
    INSERT INTO user_sessions (
      id, user_id, token_hash, expires_at, ip_address, user_agent,
      is_impersonation, impersonated_by
    )
    VALUES (
      ${sessionId}, ${targetUserId}, ${tokenHash}, ${expiresAt.toISOString()},
      ${ipAddress || null}, ${userAgent || null},
      TRUE, ${impersonatedBy}
    )
  `;

  return {
    id: sessionId,
    userId: targetUserId,
    tokenHash,
    expiresAt,
    createdAt: new Date(),
    ipAddress,
    userAgent,
    // Impersonation is an interactive browser session — full access, and swept by
    // "log out everywhere" like any other browser session.
    kind: 'browser',
  };
}

/**
 * Validate a session exists and is not expired
 */
export async function validateSession(
  sessionId: string,
  token: string
): Promise<boolean> {
  const tokenHash = hashToken(token);

  const result = await sql`
    SELECT id, expires_at
    FROM user_sessions
    WHERE id = ${sessionId}
      AND token_hash = ${tokenHash}
      AND expires_at > NOW()
  `;

  return result.length > 0;
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const result = await sql`
    SELECT id, user_id, token_hash, expires_at, created_at, ip_address, user_agent,
           kind, label, last_used_at
    FROM user_sessions
    WHERE id = ${sessionId}
      AND expires_at > NOW()
  `;

  const row = result[0];
  if (!row) return null;

  return {
    id: row.id as string,
    userId: row.user_id as string,
    tokenHash: row.token_hash as string,
    expiresAt: new Date(row.expires_at as string),
    createdAt: new Date(row.created_at as string),
    ipAddress: row.ip_address as string | undefined,
    userAgent: row.user_agent as string | undefined,
    kind: ((row.kind as string) ?? 'browser') as SessionKind,
    label: (row.label as string | null) ?? undefined,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : undefined,
  };
}

/**
 * Delete a specific session (logout)
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await sql`
    DELETE FROM user_sessions
    WHERE id = ${sessionId}
  `;
}

/**
 * Delete a user's sessions of one single kind.
 *
 * NOTE: no production caller passes through here today. "Log out of all devices"
 * deliberately uses `deleteEveryUserSession` — a user who asks to be signed out
 * everywhere means everywhere, connectors included — and routine logout drops only
 * the current session via `deleteSession`. This is kept for kind-scoped sweeps
 * (e.g. a future "revoke all my MCP tokens" action) and is covered by tests only.
 *
 * For a credential-compromise sweep (password reset, offboarding) use
 * `deleteEveryUserSession` — this function will leave other kinds alive.
 */
export async function deleteAllUserSessions(
  userId: string,
  kind: SessionKind = 'browser'
): Promise<void> {
  await sql`
    DELETE FROM user_sessions
    WHERE user_id = ${userId} AND kind = ${kind}
  `;
}

/**
 * Delete EVERY session a user holds, of every kind — the credential-compromise sweep.
 *
 * A password reset means "assume everything I had is burnt", so an MCP token must not
 * outlive it. Kept as a distinct, kind-agnostic function rather than an argument to
 * `deleteAllUserSessions` so that adding a future session kind cannot silently narrow
 * this sweep.
 */
export async function deleteEveryUserSession(userId: string): Promise<void> {
  await sql`
    DELETE FROM user_sessions
    WHERE user_id = ${userId}
  `;
}

/**
 * Get all active sessions for a user, optionally narrowed to one kind.
 */
export async function getUserSessions(userId: string, kind?: SessionKind): Promise<Session[]> {
  // Two explicit branches rather than an interpolated condition: conditional SQL
  // fragments break the Neon tagged-template shim used by this module.
  const result = kind
    ? await sql`
        SELECT id, user_id, token_hash, expires_at, created_at, ip_address, user_agent,
               kind, label, last_used_at
        FROM user_sessions
        WHERE user_id = ${userId} AND expires_at > NOW() AND kind = ${kind}
        ORDER BY created_at DESC
      `
    : await sql`
        SELECT id, user_id, token_hash, expires_at, created_at, ip_address, user_agent,
               kind, label, last_used_at
        FROM user_sessions
        WHERE user_id = ${userId} AND expires_at > NOW()
        ORDER BY created_at DESC
      `;

  return result.map((row) => ({
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    kind: (row.kind ?? 'browser') as SessionKind,
    label: row.label ?? undefined,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
  }));
}

/**
 * Clean up expired sessions (run periodically)
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await sql`
    DELETE FROM user_sessions
    WHERE expires_at < NOW()
    RETURNING id
  `;

  return result.length;
}

/**
 * Extend session expiry (refresh)
 */
export async function extendSession(sessionId: string): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  await sql`
    UPDATE user_sessions
    SET expires_at = ${expiresAt.toISOString()}
    WHERE id = ${sessionId}
  `;
}
