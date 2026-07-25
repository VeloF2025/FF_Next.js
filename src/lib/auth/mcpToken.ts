/**
 * FibreFlow read-only MCP tokens.
 *
 * An MCP token is an ordinary FibreFlow JWT (JWT_SECRET) bound to a `user_sessions`
 * row tagged kind='mcp'. That gives us, for free and with no new verification path:
 *   - offboarding      — getUserFromRequest checks `u.is_active` on every request
 *   - per-token revoke — delete the session row
 *   - live permissions — `u.permissions` is read per request, never from the JWT
 * The read-only restriction is enforced in withAuth/requireAuth (see ./readOnly).
 *
 * NOT to be confused with src/lib/cortex/bridgeAuth.ts::mintMcpToken, which signs with
 * the server-only BRIDGE_JWT_SECRET gateway secret to assert an identity TO Cortex.
 * This module signs with JWT_SECRET to authenticate a user TO FibreFlow.
 */
import { createSession, setSessionTokenHash } from './session';
import { signToken } from './jwt';
import type { AuthUser } from './types';

export type McpLifetime = '30d' | '90d' | '1y';

export const MCP_LIFETIME_DAYS: Record<McpLifetime, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

/**
 * Every identity gets the same lifetime menu, including the owner.
 *
 * An earlier revision capped the owner at 90 days, on the grounds that the owner
 * bypasses participant scoping on the meeting endpoints and so has tenant-wide read
 * blast radius. That cap was dropped deliberately: it was never the offboarding
 * control — `withAuth`/`requireAuth` re-check `u.is_active` on EVERY request, so
 * deactivating a user kills their tokens on the next call rather than at expiry — and
 * the residual risk it addressed (an undetected leak) is already covered by instant
 * per-token revocation and the `last_used_at` column, which makes a live-but-forgotten
 * token visible in the connections list.
 */

export interface MintOptions {
  label?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface MintedToken {
  token: string;
  expiresAt: Date;
  sessionId: string;
}

/**
 * Mint a read-only MCP token for an already-verified user.
 *
 * The caller MUST pass a server-verified `AuthUser` (i.e. `req.user`), never a
 * client-supplied identity. The token is returned exactly once and is not recoverable.
 */
export async function mintFfMcpToken(
  user: AuthUser,
  lifetime: McpLifetime,
  opts?: MintOptions
): Promise<MintedToken> {
  const days = MCP_LIFETIME_DAYS[lifetime];

  // create -> sign -> bind: the JWT embeds the session id, so the row must exist first,
  // and the row's token_hash can only be written once the JWT exists. Same three-step
  // dance as pages/api/auth/login.ts.
  const session = await createSession(user.id, '', opts?.ipAddress, opts?.userAgent, {
    kind: 'mcp',
    expiryDays: days,
    label: opts?.label,
  });
  const token = await signToken(user, session.id, `${days}d`);
  await setSessionTokenHash(session.id, token);

  return { token, expiresAt: session.expiresAt, sessionId: session.id };
}
