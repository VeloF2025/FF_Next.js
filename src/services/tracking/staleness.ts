/**
 * How long a feed may stay quiet before its last fix stops counting as live.
 *
 * One flat 15-minute threshold used to judge every provider, which made the
 * slow feeds permanently "stale": on 2026-08-09 Netstar's freshest fix was 118
 * minutes old and Ituran's 76, so those vehicles could never be anything but
 * grey however healthy they were. A signal that fires constantly is one nobody
 * reads.
 *
 * The cadence used to be a constant here, under the assumption that it was
 * fixed by cron. It is not: `fleet_tracking_watermarks.poll_interval_minutes`
 * (see cadence.ts, which ramps it per account from 2h down to 10min) is now
 * the single source of truth for how often a feed is expected to tick, and
 * this function just doubles whatever interval it is given. It no longer
 * needs to know which provider or account is which — Cartrack's fast REST
 * account and slow portal account each carry their own configured interval,
 * so the threshold is right for both without any branch here.
 *
 * Note this measures the age of the last EVENT, which is not the same as "when
 * we last reached the tracker": a parked car emits nothing, and a snapshot
 * provider keeps returning the same old fix. Distinguishing "tracker dark" from
 * "car parked" needs a recorded contact time the ingest does not store today.
 * Until then, treat a breach as "we have not heard anything", not as proof the
 * tracker is dead.
 */

/**
 * Fallback for a feed with no configured interval — e.g. a vehicle whose
 * last position has no matching `fleet_tracking_watermarks` row. Judged
 * leniently on purpose: a false "stale" is the failure this module exists to
 * remove, while a late flag merely delays a rare one.
 */
export const DEFAULT_STALE_AFTER_SECONDS = 3 * 3600;

/** One missed tick is tolerated; two means we genuinely have not heard. */
const MISSED_TICKS_TOLERATED = 2;

/** Seconds a fix from this feed may age before it is no longer "live". */
export function staleAfterSecondsFor(
  provider: string | null,
  accountRef: string | null,
  intervalMinutes: number | null
): number {
  if (!provider || !accountRef) return DEFAULT_STALE_AFTER_SECONDS;

  // `== null` also catches `undefined`, which is what a row with no matching
  // watermark join carries. A strict `=== null` guard would let that through
  // to `undefined * MISSED_TICKS_TOLERATED * 60`, i.e. NaN — and every
  // `ageSeconds > staleAfterSeconds` comparison against NaN is silently false,
  // so nothing would ever be flagged stale rather than falling back leniently.
  if (intervalMinutes == null) return DEFAULT_STALE_AFTER_SECONDS;

  return intervalMinutes * MISSED_TICKS_TOLERATED * 60;
}
