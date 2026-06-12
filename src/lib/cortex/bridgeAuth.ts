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
import { SignJWT } from 'jose';

/** Short-lived: the token only needs to outlive a single review request. */
const TOKEN_TTL = '5m';

function oidcForwardEnabled(): boolean {
  return (process.env.CORTEX_OIDC_FORWARD ?? '').trim().toLowerCase() === 'true';
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

  const secret = process.env.BRIDGE_JWT_SECRET ?? '';
  if (!secret) {
    // Dark fallback — service-scoped api key (or empty when unconfigured).
    return process.env.CORTEX_API_KEY ?? '';
  }
  const instanceId = process.env.CORTEX_INSTANCE_ID ?? 'velocity-fibre';
  // Cortex Phase 3 WP8 key rotation: when BRIDGE_JWT_KID is set, stamp it into
  // the protected header so the bridge verifies STRICTLY against that key.
  // Unset = legacy kid-less signing (bridge tries all trusted keys).
  const kid = process.env.BRIDGE_JWT_KID || undefined;
  try {
    return await new SignJWT({ email: reviewerEmail, instance_id: instanceId })
      .setProtectedHeader(kid ? { alg: 'HS256', kid } : { alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(TOKEN_TTL)
      .sign(new TextEncoder().encode(secret));
  } catch (err) {
    // Fail CLOSED, never silently downgrade to the broad service credential: if the
    // gateway secret is present but signing fails, surface a clear error (without
    // leaking the secret) and let the route's error boundary return a 500.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`bridgeAuth: failed to mint per-user Bridge JWT: ${reason}`);
  }
}
