/**
 * Owner identity — the unrestricted-access bypass used by the meeting endpoints.
 *
 * Historically inlined as a string literal in four route handlers. Centralised here so
 * there is exactly one place to audit, one place to rotate, and one place for the
 * MCP-token lifetime cap to consult (see src/lib/auth/mcpToken.ts).
 *
 * Read at CALL time, not module load, so the value can be rotated without a restart —
 * matching the convention in src/lib/cortex/bridgeAuth.ts::isSuperAdmin.
 */

/** Historical owner, kept as the default so behaviour is unchanged when the env var is unset. */
const DEFAULT_OWNER_EMAILS = 'hein@velocityfibre.co.za';

/**
 * The configured owner emails, lowercased.
 *
 * UNSET (`undefined`) falls back to the historical owner. An explicitly EMPTY or
 * whitespace-only value does NOT — it yields no owners at all, disabling the bypass.
 *
 * That asymmetry is deliberate. `FF_OWNER_EMAILS=` is a plausible way to say "turn the
 * owner bypass off", and falling back to the default there would silently re-grant
 * unrestricted access to every meeting endpoint — failing open on an authorization
 * check. Losing owner access is recoverable by unsetting the var; silently handing it
 * back to someone who tried to revoke it is not.
 */
export function ownerEmails(): string[] {
  return (process.env.FF_OWNER_EMAILS ?? DEFAULT_OWNER_EMAILS)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwner(user: { email?: string | null } | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  if (!email) return false;
  return ownerEmails().includes(email);
}
