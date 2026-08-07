/**
 * Stops a provider being called at all once its credential is known bad.
 *
 * Separate from the poll loop because the reasoning is about a third party's
 * rate limits, not about polling.
 */
import { log } from '@/lib/logger';
import { raiseTrackingAlert } from '@/services/tracking/alerts';
import { isAuthFailure } from '@/services/tracking/authFailure';
import type { ProviderKey } from '@/services/tracking/types';

/**
 * Consecutive AUTH failures before a provider stops being called at all.
 *
 * Sized against the tightest known limit: Cartrack's ct_login locks an account
 * out after roughly 20 failures. Three burns a sixth of that budget before the
 * breaker opens — enough to ride out a genuine blip without approaching the
 * ceiling. Any successful tick resets consecutive_failures to 0, closing it.
 */
export const AUTH_BREAKER_THRESHOLD = 3;

/**
 * Whether to stop calling a provider entirely.
 *
 * Portal logins are rate-limited by the far side, and at least one of them
 * enforces a hard, numbered account lockout that takes the data source with it.
 * A credential that has gone bad — a rotated password, an expired sub-user —
 * fails identically on every tick, so retrying blindly every two hours burns
 * that budget in under two days, unattended, over a weekend.
 *
 * consecutive_failures was written on every failure but never read. This is
 * what reads it. Deliberately narrow: a transient or gap streak also increments
 * the counter, and those CAN self-heal, so only a last_error that classifies as
 * an auth failure opens the breaker.
 */
export function isAuthCircuitOpen(
  consecutiveFailures: number,
  lastError: string | null
): boolean {
  return consecutiveFailures >= AUTH_BREAKER_THRESHOLD && isAuthFailure(lastError ?? '');
}

/**
 * Reports an open circuit and returns the tick's result.
 *
 * Still alerts on EVERY tick: the breaker stops the retries, not the reporting.
 * Nobody may be reading the logs, and an open breaker means this account is
 * ingesting nothing at all.
 */
export async function reportOpenCircuit(
  provider: ProviderKey,
  accountRef: string,
  failures: number,
  priorError: string
): Promise<Record<string, unknown>> {
  log.error('[poll-portal-tracking] auth circuit OPEN — refusing to re-authenticate', {
    provider, accountRef, consecutiveFailures: failures, lastError: priorError,
    hint: 'fix the credential; the next successful tick closes the breaker automatically',
  });
  await raiseTrackingAlert({
    kind: 'auth',
    consecutiveFailures: failures,
    nowSast: new Date(),
    provider,
    accountRef,
    detail: `auth circuit open after ${failures} consecutive failures — not retrying: ${priorError}`,
  });
  return { provider, accountRef, skipped: 'auth-circuit-open', consecutiveFailures: failures, lastError: priorError };
}
