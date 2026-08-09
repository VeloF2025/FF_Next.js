/**
 * How long a feed may stay quiet before its last fix stops counting as live.
 *
 * One flat 15-minute threshold used to judge every provider, which made the
 * slow feeds permanently "stale": on 2026-08-09 Netstar's freshest fix was 118
 * minutes old and Ituran's 76, so those vehicles could never be anything but
 * grey however healthy they were. A signal that fires constantly is one nobody
 * reads.
 *
 * The cadence is set by cron, and it splits by ACCOUNT rather than by provider
 * name, because Cartrack runs two feeds at once:
 *
 *   every 2 min   poll-tracking         → cartrack REST
 *   every 2 h     poll-portal-tracking  → netstar, AND the cartrack fleetweb
 *                                         PORTAL
 *   every 2 h     poll-ituran-tracking  → ituran
 *
 * So `cartrack` alone cannot answer this: its REST account is polled every 2
 * minutes and its portal account every 2 hours, and judging the portal by the
 * REST threshold would flag all of its vehicles as stale forever — the very
 * bug this fixes.
 *
 * WHY THIS IS EXPRESSED AS "which account is the PORTAL", rather than the more
 * obvious "which account is the fast one": the fast account's name comes from
 * `CARTRACK_ACCOUNT_REF`, which is set on dev and UNSET on production (where
 * the ingest would fall back to writing 'default'). Naming it here — as a
 * literal or by reading that env var — silently stops matching the moment the
 * cron moves environments, and the fast feed would quietly inherit the lenient
 * threshold with nothing to show for it. The PORTAL account is read from the
 * same env var as the portal config itself and falls back to the same 'urent'
 * on both environments, so it cannot drift from the thing it names. Anything
 * else on Cartrack is the REST feed by construction.
 *
 * Note this measures the age of the last EVENT, which is not the same as "when
 * we last reached the tracker": a parked car emits nothing, and a snapshot
 * provider keeps returning the same old fix. Distinguishing "tracker dark" from
 * "car parked" needs a recorded contact time the ingest does not store today.
 * Until then, treat a breach as "we have not heard anything", not as proof the
 * tracker is dead.
 */

/**
 * The 2-hourly portal cadence plus an hour of grace, so one missed tick is not
 * an alarm. Also the fallback for any provider not named below: an unrecognised
 * feed is judged leniently on purpose, because a false "stale" is the failure
 * this module exists to remove, while a late flag merely delays a rare one.
 */
export const DEFAULT_STALE_AFTER_SECONDS = 3 * 3600;

/** Cartrack's REST feed is polled every 2 minutes; 15 min is ~7 missed ticks. */
export const FAST_STALE_AFTER_SECONDS = 15 * 60;

/**
 * Read at call time, not at import: the module would otherwise capture whatever
 * env existed when the server started, and the value could not be exercised by
 * a test.
 */
function cartrackPortalAccount(env: NodeJS.ProcessEnv = process.env): string {
  // Same expression as cartrack/portalConfig.ts. If that default ever changes,
  // both must change together — they are naming one account.
  return env.CARTRACK_PORTAL_ACCOUNT_REF ?? 'urent';
}

/** Seconds a fix from this feed may age before it is no longer "live". */
export function staleAfterSecondsFor(
  provider: string | null,
  accountRef: string | null,
  env: NodeJS.ProcessEnv = process.env
): number {
  if (!provider || !accountRef) return DEFAULT_STALE_AFTER_SECONDS;

  if (provider === 'cartrack') {
    // Everything on Cartrack that is not the portal is the REST feed — see the
    // header for why the test runs this way round.
    return accountRef === cartrackPortalAccount(env)
      ? DEFAULT_STALE_AFTER_SECONDS
      : FAST_STALE_AFTER_SECONDS;
  }

  // Netstar and Ituran are both 2-hourly portals.
  return DEFAULT_STALE_AFTER_SECONDS;
}
