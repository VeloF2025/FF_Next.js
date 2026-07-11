/**
 * Cortex Bridge per-user authentication.
 *
 * Returns the credential FibreFlow sends to the Cortex bridge as
 * `Authorization: Bearer <...>` on meeting-review calls. Credential precedence:
 *
 *  1. **Entra ID token forward** (Phase 6, flagged `CORTEX_OIDC_FORWARD`): when the
 *     flag is on AND a verified Entra ID token is available for this user, forward
 *     THAT token. The bridge verifies it with real OIDC (RS256 + JWKS + iss/aud,
 *     `apps/bridge/oidc.py`) — no shared symmetric secret can forge it. This is the
 *     real identity upgrade; HS256 below is the stopgap it replaces.
 *  2. **HS256 gateway JWT** (`BRIDGE_JWT_SECRET` set): mint a short-lived HS256 JWT
 *     asserting the verified reviewer ({ email, instance_id, exp }). Cortex verifies
 *     the signature against the SAME shared secret and narrows to that user.
 *  3. **`CORTEX_API_KEY`** (neither above): the dark default — tenant-scoped service
 *     identity; per-user narrowing on the Cortex side stays dormant.
 *
 * TRUST MODEL: `BRIDGE_JWT_SECRET` is a server-only gateway secret, distinct from the
 * user-facing `JWT_SECRET` used for FibreFlow's own sessions. Anyone holding it can
 * assert any email to Cortex, so it must never reach the browser. `req.user.email`
 * (already verified by `withAuth`) is the only source of the asserted identity — never
 * a client-supplied value. The Entra ID token (tier 1) is likewise read only from the
 * server-side session, never a client-supplied header.
 */
import { SignJWT, decodeJwt } from 'jose';

/** Short-lived: the token only needs to outlive a single review request. */
const TOKEN_TTL = '5m';

/**
 * User-selectable self-serve MCP token lifetime (Phase 7 UI, Phase 9 widens the
 * endpoint's allow-list to include `never`). `null` days means no `exp` claim at
 * all — the bridge's revocation marker (`token_use:"mcp"` + min_iat epoch) is then
 * the ONLY way to invalidate the token.
 */
export type Lifetime = '30d' | '90d' | '1y' | 'never';

export const LIFETIME_DAYS: Record<Lifetime, number | null> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  never: null,
};

/**
 * Super-admin MCP tokens see the whole tenant, so their blast radius on loss/leak is
 * capped at 90 days — `1y` and `never` are rejected for these emails. Same csv env
 * as the bridge's own super-admin set. Read at CALL time (not module load) so it can
 * be rotated / toggled without a process restart, matching this file's existing
 * env-read convention (see `oidcForwardEnabled`).
 */
function isSuperAdmin(email: string): boolean {
  const emails = (process.env.CORTEX_SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return emails.includes(email.trim().toLowerCase());
}

/** Marks a revocable MCP bearer token — the bridge applies per-user revocation
 *  (the min_iat epoch) ONLY to tokens carrying this claim, never to the 5-minute
 *  session tokens minted by bridgeBearer. Forward-compatible with the Cortex-side
 *  revocation marker (Cortex PR #109: scripts/mint_user_token.py +
 *  plugins/memory/cortex/mcp_revocation.MCP_TOKEN_USE) — kept in sync with it. Inert
 *  on a bridge that predates #109 (the extra claim is simply ignored by PyJWT). */
const MCP_TOKEN_USE = 'mcp';

function oidcForwardEnabled(): boolean {
  return (process.env.CORTEX_OIDC_FORWARD ?? '').trim().toLowerCase() === 'true';
}

/**
 * Sign an HS256 gateway JWT with the shared `BRIDGE_JWT_SECRET` (+ optional `kid`).
 *
 * The SINGLE place that reads the gateway secret and drives `jose.SignJWT`, so the
 * secret never reaches a second code path. Returns `null` when the secret is unset
 * (the caller decides the fallback). `setIssuedAt()` stamps `iat`; the bridge derives
 * the revocation comparison and `exp` from these. Env is read at call time so the
 * secret can be rotated / toggled without a process restart.
 *
 * @param ttl a jose duration string (e.g. `'30d'`), or `null` to omit `exp`
 *   entirely (the `never`-expiring lifetime — revocation is then the only way to
 *   invalidate the token).
 */
async function signBridgeJwt(
  claims: Record<string, unknown>,
  ttl: string | null,
): Promise<string | null> {
  const secret = process.env.BRIDGE_JWT_SECRET ?? '';
  if (!secret) return null;
  // Cortex Phase 3 WP8 key rotation: when BRIDGE_JWT_KID is set, stamp it into the
  // protected header so the bridge verifies STRICTLY against that key. Unset =
  // legacy kid-less signing (bridge tries all trusted keys).
  const kid = process.env.BRIDGE_JWT_KID || undefined;
  try {
    let builder = new SignJWT(claims)
      .setProtectedHeader(kid ? { alg: 'HS256', kid } : { alg: 'HS256' })
      .setIssuedAt();
    if (ttl !== null) {
      builder = builder.setExpirationTime(ttl);
    }
    return await builder.sign(new TextEncoder().encode(secret));
  } catch (err) {
    // Fail CLOSED, never silently downgrade to the broad service credential: if the
    // gateway secret is present but signing fails, surface a clear error (without
    // leaking the secret) and let the caller's error boundary return a 500.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`bridgeAuth: failed to mint Bridge JWT: ${reason}`);
  }
}

/**
 * Build the `Authorization: Bearer` credential for a Cortex review call made on behalf
 * of `reviewerEmail` (the server-verified FibreFlow user). Env is read at call time so
 * the secret can be rotated / toggled without a process restart.
 *
 * @param reviewerEmail server-verified FibreFlow user email (never client-supplied).
 * @param opts.entraIdToken the Entra ID token for this user, already BOUND to
 *   `reviewerEmail` and read from the server-side cookie by the caller (via
 *   `getForwardableEntraIdToken`, which rejects a mismatched-subject or expired token).
 *   When `CORTEX_OIDC_FORWARD=true` and this is present, it is forwarded as the bearer
 *   (tier 1). Absent/flag-off → HS256/api-key. This function does not re-bind identity;
 *   it trusts the caller's binding, hence the strict typing of the call sites.
 */
export async function bridgeBearer(
  reviewerEmail: string,
  opts: { entraIdToken?: string } = {},
): Promise<string> {
  // Tier 1 — forward the real Entra ID token when enabled and available.
  const entra = opts.entraIdToken?.trim();
  if (oidcForwardEnabled() && entra) {
    return entra;
  }

  const instanceId = process.env.CORTEX_INSTANCE_ID ?? 'velocity-fibre';
  const token = await signBridgeJwt({ email: reviewerEmail, instance_id: instanceId }, TOKEN_TTL);
  if (token === null) {
    // Dark fallback — service-scoped api key (or empty when unconfigured).
    return process.env.CORTEX_API_KEY ?? '';
  }
  return token;
}

/** Thrown when a super-admin requests a lifetime beyond the 90-day cap. A distinct
 *  class so the route can map it to a 400 (the UI offers `1y` to everyone, so this is
 *  a normal user action, not a server fault) while every other mint failure stays 500. */
export class McpLifetimeCapError extends Error {
  constructor() {
    super('Super-admin tokens are capped at 90 days — choose 30 or 90 days.');
    this.name = 'McpLifetimeCapError';
  }
}

/** A minted MCP bearer token plus its expiry, for display in the connect UI. */
export interface McpToken {
  /** The HS256 JWT to paste into an MCP client config as CORTEX_USER_TOKEN. */
  token: string;
  /** ISO-8601 expiry, decoded from the token's own `exp`, or `null` for `never`
   *  (no `exp` claim at all — revocation is the only way to invalidate it). */
  expiresAt: string | null;
}

/**
 * Mint a per-user Cortex MCP bearer token for `userEmail`, valid for the
 * user-selected `lifetime` (default `30d`).
 *
 * Matches `scripts/mint_user_token.py` (the operator path) — claims
 * `sub, email, instance_id, iat, exp` — plus the `token_use:"mcp"` revocation marker
 * (Cortex PR #109) and a unique `jti`, so operator- and UI-minted tokens are
 * interchangeable and equally revocable/traceable. The bridge narrows every result to
 * this user's ACL; the token carries no extra privilege.
 *
 * @param userEmail the server-verified FibreFlow session email — NEVER a
 *   client-supplied value (the route reads it from `req.user.email`).
 * @param lifetime how long the token is valid for. `never` omits `exp` entirely.
 *   Super-admin emails (`CORTEX_SUPER_ADMIN_EMAILS`) are capped at `90d` — their
 *   tokens see the whole tenant, so `1y`/`never` are rejected to bound blast radius.
 * @throws if `BRIDGE_JWT_SECRET` is unset — fail LOUD rather than silently issuing a
 *   broad service credential or an empty bearer. Throws `McpLifetimeCapError` when a
 *   super-admin requests a lifetime beyond the 90-day cap.
 */
export async function mintMcpToken(
  userEmail: string,
  lifetime: Lifetime = '30d',
): Promise<McpToken> {
  if (isSuperAdmin(userEmail) && (lifetime === '1y' || lifetime === 'never')) {
    throw new McpLifetimeCapError();
  }
  const instanceId = process.env.CORTEX_INSTANCE_ID ?? 'velocity-fibre';
  const days = LIFETIME_DAYS[lifetime];
  const ttl = days === null ? null : `${days}d`;
  const jti = crypto.randomUUID();
  const token = await signBridgeJwt(
    { sub: userEmail, email: userEmail, instance_id: instanceId, token_use: MCP_TOKEN_USE, jti },
    ttl,
  );
  if (token === null) {
    throw new Error('bridgeAuth: BRIDGE_JWT_SECRET is not set — cannot mint an MCP token');
  }
  // Read exp back from the signed token so expiresAt is exactly what the bridge sees.
  // (undefined for `never` — no exp claim was set.)
  const { exp } = decodeJwt(token);
  const expiresAt = typeof exp === 'number' ? new Date(exp * 1000).toISOString() : null;
  return { token, expiresAt };
}
