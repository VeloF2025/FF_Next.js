/**
 * The FibreFlow API grant attached to a Cortex connector authorisation.
 *
 * Cortex already authenticates its users THROUGH FibreFlow — `/cortex/mcp/authorize`
 * runs behind `withAuth`, and `/api/cortex/mcp-consent` mints a bridge token asserting
 * that verified identity to Cortex. What Cortex has never held is a credential to call
 * FibreFlow BACK, so its tools cannot read FF data as the person driving them.
 *
 * This module decides whether that credential is issued, and for how long. The token
 * itself is minted by `mintFfMcpToken`, which is read-only by construction
 * (`withAuth`/`requireAuth` enforce it), bound to a revocable `user_sessions` row, and
 * re-reads `u.is_active` and `u.permissions` on EVERY request — so the grant carries the
 * user's live permissions rather than a snapshot, and deactivating them kills it on the
 * next call rather than at expiry.
 *
 * Why it is a separate, defaulted-off decision rather than part of the existing consent:
 * it changes what the user is agreeing to from "Cortex reads my meetings" to "Cortex
 * reads anything in FibreFlow I can". That is a materially wider grant, so it ships dark
 * and the consent screen has to name it.
 */

import type { CortexMcpLifetime } from './mcpLifetimePolicy';
import type { McpLifetime } from '@/lib/auth/mcpToken';

/**
 * Map a Cortex connector lifetime onto an FF token lifetime.
 *
 * Cortex offers `never`; FibreFlow deliberately has no unbounded option, so it clamps to
 * the longest bounded one. Revocation and the `is_active` re-check are the real controls
 * — expiry is the backstop for the case where both are missed, and a credential that
 * never expires removes it entirely.
 */
export function ffGrantLifetime(lifetime: CortexMcpLifetime): McpLifetime {
  return lifetime === 'never' ? '1y' : lifetime;
}

/**
 * Whether the grant is enabled at all.
 *
 * Fails closed on everything except an explicit `true`. A grant this wide must not switch
 * itself on because someone wrote `1` or `yes` in an env file.
 */
export function ffApiGrantEnabled(env: Record<string, string | undefined>): boolean {
  return (env.CORTEX_FF_API_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * The line shown to the user on the consent screen.
 *
 * Deliberately states the breadth AND the bound. "Read your meetings" would understate
 * what is being granted; omitting "only what you can already see" would overstate it and
 * make a non-escalating grant read like an escalation.
 */
export function ffGrantConsentScope(): string {
  return 'Read-only access to FibreFlow data you can already see — the same permissions you have in the app, never more.';
}
