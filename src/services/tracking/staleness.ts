/**
 * How long a feed may stay quiet before its last fix stops counting as live.
 *
 * One flat 15-minute threshold used to judge every provider, which made the
 * slow feeds permanently "stale": on 2026-08-09 Netstar's freshest fix was 118
 * minutes old and Ituran's 76, so those vehicles could never be anything but
 * grey however healthy they were. A signal that fires constantly is one nobody
 * reads.
 *
 * The cadence is set by cron, not by the provider, and it splits by ACCOUNT
 * rather than by provider name — Cartrack runs on both. Taken from the crontab
 * on velo:
 *
 *   every 2 min   poll-tracking         → cartrack REST   (velocity)
 *   every 2 h     poll-portal-tracking  → netstar (europcar) AND the cartrack
 *                                         fleetweb PORTAL (urent)
 *   every 2 h     poll-ituran-tracking  → ituran   (avis)
 *
 * (Written out rather than pasted as cron syntax: a literal schedule contains
 * the characters that end a block comment.)
 *
 * So `cartrack` alone is not enough to answer this: velocity is polled every 2
 * minutes and urent every 2 hours, and judging urent by velocity's threshold
 * would flag all 3 of its vehicles as stale forever — the very bug this fixes.
 *
 * Note this measures the age of the last EVENT, which is not the same as "when
 * we last reached the tracker": a parked car emits nothing, and a snapshot
 * provider keeps returning the same old fix. Distinguishing "tracker dark" from
 * "car parked" needs a recorded contact time the ingest does not store today.
 * Until then, treat a breach as "we have not heard anything", not as proof the
 * tracker is dead.
 */
import type { ProviderKey } from './types';

/**
 * The 2-hourly portal cadence plus an hour of grace, so one missed tick is not
 * an alarm. Also the fallback: an unrecognised feed is judged leniently on
 * purpose, because a false "stale" is the failure this module exists to remove,
 * while a late flag merely delays a rare one.
 */
export const DEFAULT_STALE_AFTER_SECONDS = 3 * 3600;

/**
 * Only feeds polled FASTER than the 2-hourly default need an entry — keyed
 * `provider:account_ref`. If an account is renamed in env and stops matching,
 * it silently falls back to the lenient default rather than alarming; that is
 * the safe direction, and the cost is a slower flag on one feed.
 */
const FAST_FEEDS: Readonly<Record<string, number>> = {
  // Cartrack's REST feed, polled every 2 minutes. 15 min is ~7 missed ticks.
  'cartrack:velocity': 15 * 60,
};

/** Seconds a fix from this feed may age before it is no longer "live". */
export function staleAfterSecondsFor(
  provider: ProviderKey | string | null,
  accountRef: string | null
): number {
  if (!provider || !accountRef) return DEFAULT_STALE_AFTER_SECONDS;
  return FAST_FEEDS[`${provider}:${accountRef}`] ?? DEFAULT_STALE_AFTER_SECONDS;
}
