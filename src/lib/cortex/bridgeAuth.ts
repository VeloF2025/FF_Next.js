/**
 * Cortex Bridge per-user authentication.
 *
 * Returns the credential FibreFlow sends to the Cortex bridge as
 * `Authorization: Bearer <...>` on meeting-review calls.
 *
 *  - `BRIDGE_JWT_SECRET` set  → mint a short-lived HS256 JWT asserting the verified
 *    FibreFlow reviewer ({ email, instance_id, exp }). Cortex verifies the signature
 *    against the SAME shared secret and narrows access to that user's meetings.
 *  - `BRIDGE_JWT_SECRET` unset → fall back to the shared `CORTEX_API_KEY` (today's
 *    behaviour). This is the dark default: until the secret is shared between
 *    FibreFlow and Cortex, every call stays tenant-scoped (service identity) and the
 *    per-user narrowing on the Cortex side is dormant.
 *
 * TRUST MODEL: `BRIDGE_JWT_SECRET` is a server-only gateway secret, distinct from the
 * user-facing `JWT_SECRET` used for FibreFlow's own sessions. Anyone holding it can
 * assert any email to Cortex, so it must never reach the browser. `req.user.email`
 * (already verified by `withAuth`) is the only source of the asserted identity — never
 * a client-supplied value.
 */
import { SignJWT } from 'jose';

/** Short-lived: the token only needs to outlive a single review request. */
const TOKEN_TTL = '5m';

/**
 * Build the `Authorization: Bearer` credential for a Cortex review call made on behalf
 * of `reviewerEmail` (the server-verified FibreFlow user). Env is read at call time so
 * the secret can be rotated / toggled without a process restart.
 */
export async function bridgeBearer(reviewerEmail: string): Promise<string> {
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
