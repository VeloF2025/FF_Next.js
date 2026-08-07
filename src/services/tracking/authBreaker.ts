/**
 * Throttles re-authentication once a provider's credential looks dead.
 *
 * Separate from the poll loop because the reasoning is about a third party's
 * rate limits, not about polling.
 *
 * THREE STATES, and the middle one is the point:
 *
 *   closed     — under the failure threshold. Poll normally.
 *   half-open  — over the threshold, but the cooldown has elapsed: let exactly
 *                ONE tick through. Its own success or failure writes the
 *                watermark, so a fixed credential heals the provider by itself.
 *   open       — over the threshold and inside the cooldown: skip the tick
 *                entirely, spending nothing against the vendor's counter.
 *
 * The half-open state is not decoration. A breaker that only ever skips is a
 * one-way latch: the early return happens BEFORE any watermark write, so
 * consecutive_failures freezes, the predicate stays true forever, and the only
 * code path that could produce the success needed to clear it is the very one
 * being blocked. Recovery would then require a human to know about, find and
 * hand-edit a DB row. Probing is what makes "fix the credential and it heals"
 * true rather than a comforting lie.
 *
 * Budget arithmetic, against Cartrack's ~20-attempt lockout — the tightest
 * limit known: 3 failures to open, then at most one probe per PROBE_COOLDOWN_MS
 * (24h), stopping entirely at HARD_STOP. That is 3 + 9 = 12 attempts spread
 * over nine days, leaving ~8 unspent. A 2-hourly cron with no breaker at all
 * burns the whole budget in under two days.
 */
import { log } from '@/lib/logger';
import { raiseTrackingAlert } from '@/services/tracking/alerts';
import { isAuthFailure } from '@/services/tracking/authFailure';
import type { ProviderKey } from '@/services/tracking/types';

/** Consecutive auth failures before polling is throttled. */
export const AUTH_BREAKER_THRESHOLD = 3;

/**
 * How long to wait between probes while throttled.
 *
 * Long enough that probing cannot approach a vendor lockout (one attempt per
 * day), short enough that a credential fixed in the morning is polling again
 * within a day without anyone touching the database.
 */
export const AUTH_PROBE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Failures after which probing stops for good and a human must intervene.
 *
 * At this point the credential has been rejected on nine consecutive daily
 * probes; continuing would eventually reach the vendor's lockout, which is the
 * one outcome worth avoiding at any cost — losing the account loses the data
 * source. Recovery is the documented SQL in `.claude/modules/fleet.md`.
 */
export const AUTH_HARD_STOP = 12;

export type BreakerDecision =
  | { state: 'closed' }
  | { state: 'half-open'; failures: number }
  | { state: 'open'; failures: number; retryInMs: number }
  | { state: 'hard-stop'; failures: number };

/**
 * What to do with this tick.
 *
 * Deliberately narrow: a transient or gap streak also increments
 * consecutive_failures, and those CAN self-heal, so only a last_error that
 * classifies as an auth failure throttles anything.
 *
 * Pure, so the state machine is testable without a clock or a database.
 */
export function authBreakerDecision(
  consecutiveFailures: number,
  lastError: string | null,
  lastRunAt: Date | null,
  now: Date = new Date()
): BreakerDecision {
  if (consecutiveFailures < AUTH_BREAKER_THRESHOLD || !isAuthFailure(lastError ?? '')) {
    return { state: 'closed' };
  }
  if (consecutiveFailures >= AUTH_HARD_STOP) {
    return { state: 'hard-stop', failures: consecutiveFailures };
  }
  // No last_run_at recorded: probe rather than latch shut on missing data.
  const sinceLastRun = lastRunAt ? now.getTime() - lastRunAt.getTime() : Infinity;
  if (sinceLastRun >= AUTH_PROBE_COOLDOWN_MS) {
    return { state: 'half-open', failures: consecutiveFailures };
  }
  return {
    state: 'open',
    failures: consecutiveFailures,
    retryInMs: AUTH_PROBE_COOLDOWN_MS - sinceLastRun,
  };
}

/**
 * Reports a throttled tick and returns its result.
 *
 * Alerts every tick even while skipping: the breaker stops the retries, not the
 * reporting, and a throttled provider is ingesting nothing at all.
 */
export async function reportThrottled(
  provider: ProviderKey,
  accountRef: string,
  decision: Extract<BreakerDecision, { state: 'open' | 'hard-stop' }>,
  priorError: string
): Promise<Record<string, unknown>> {
  const hardStopped = decision.state === 'hard-stop';
  // The hint has to be true. An operator reads it under pressure, and the
  // earlier version of this promised automatic recovery that could not happen.
  const hint = hardStopped
    ? `probing stopped after ${decision.failures} failures to protect the account from vendor lockout — `
      + 'fix the credential, then clear it: UPDATE fleet_tracking_watermarks '
      + "SET consecutive_failures = 0 WHERE provider = '" + provider + "' "
      + "AND account_ref = '" + accountRef + "'; (see .claude/modules/fleet.md)"
    : `fix the credential; the next probe is in ~${Math.round(
        (decision as { retryInMs: number }).retryInMs / 3_600_000
      )}h and a working credential closes this by itself`;

  log.error(
    hardStopped
      ? '[poll-portal-tracking] auth circuit HARD-STOPPED — manual reset required'
      : '[poll-portal-tracking] auth circuit open — skipping tick, will probe later',
    { provider, accountRef, consecutiveFailures: decision.failures, lastError: priorError, hint }
  );
  await raiseTrackingAlert({
    kind: 'auth',
    consecutiveFailures: decision.failures,
    nowSast: new Date(),
    provider,
    accountRef,
    detail: `${hardStopped ? 'auth circuit hard-stopped' : 'auth circuit open'} after `
      + `${decision.failures} consecutive failures: ${priorError} — ${hint}`,
  });
  return {
    provider,
    accountRef,
    skipped: hardStopped ? 'auth-circuit-hard-stop' : 'auth-circuit-open',
    consecutiveFailures: decision.failures,
    lastError: priorError,
  };
}

/** Announces the single probe a half-open circuit permits. */
export function logProbe(provider: ProviderKey, accountRef: string, failures: number): void {
  log.warn('[poll-portal-tracking] auth circuit half-open — probing once', {
    provider, accountRef, consecutiveFailures: failures,
    hint: 'a working credential closes the circuit; a failing one re-arms the cooldown',
  });
}
