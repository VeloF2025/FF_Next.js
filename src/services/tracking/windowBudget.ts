/**
 * How far back a poll may ask a provider to go.
 *
 * These feeds are account-wide — one request returns every vehicle in the
 * window — so a window's event count scales with the fleet, and a window wide
 * enough to blow the provider's pagination budget throws instead of returning
 * a short page. That makes window width a real constraint rather than a knob,
 * and the arithmetic below is the whole of the policy. It lives apart from the
 * cron handler so it can be tested as plain functions, with no HTTP and no DB.
 */

/**
 * Re-poll this far back before the watermark; dedup absorbs the overlap.
 *
 * Sized for buffering, not for clock skew. The watermark is one scalar per
 * account (max event_ts), but a vehicle that loses GSM coverage keeps
 * recording and uploads those fixes late, stamped with the event time they
 * happened at. Meanwhile the other vehicles hold the watermark near now — so
 * anything older than this overlap when it lands is never fetched again, and
 * the provider's retention cap makes it unrecoverable the next day. 30 minutes
 * covers an ordinary dropout (parking basement, rural stretch); a longer
 * outage still loses fixes, which a per-tracker watermark would fix properly
 * (#2169).
 */
export const OVERLAP_MS = 30 * 60 * 1000;

/** First run with no watermark: how far back to backfill, budget permitting. */
export const COLD_START_MS = 6 * 60 * 60 * 1000;

/**
 * Assumed events per hour per tracked vehicle, for sizing the window.
 *
 * Measured against the live Cartrack Velocity account on 2026-07-15:
 * ~200/hour/vehicle, consistent across 10min/30min/1h/6h probes. 300 carries
 * ~50% headroom, since guessing high costs a narrower window while guessing
 * low throws.
 */
export const EVENTS_PER_HOUR_PER_VEHICLE = 300;

/**
 * Fraction of the provider's event budget one window may plan to use. The rate
 * above is an average; leaving room means a burst of hard-braking events does
 * not tip an otherwise-legal window over the edge.
 */
export const BUDGET_UTILISATION = 0.8;

/**
 * Never plan a window narrower than this. Below it the fleet has outgrown a
 * single account-wide poll and no window keeps up — data is lost either way,
 * so fail visibly rather than silently shrinking to nothing.
 */
export const MIN_WINDOW_MS = 5 * 60 * 1000;

/**
 * Widest window this provider can be asked for without blowing its event
 * budget, given how many vehicles are currently feeding it.
 */
export function maxWindowMsFor(maxEventsPerFetch: number, activeTrackers: number): number {
  // Unknown budget → the NARROWEST window, not the widest. A provider whose
  // maxEventsPerFetch is unset, zero or NaN has told us nothing about what it
  // will serve, and handing it the full cold start would reintroduce exactly
  // the throw-forever failure this module exists to prevent — silently, for
  // that provider only. Guessing small merely costs history; guessing large
  // costs the whole integration. (Also stops NaN reaching Math.max, which
  // returns NaN and would sail through the clamp as an Invalid Date.)
  if (!Number.isFinite(maxEventsPerFetch) || maxEventsPerFetch <= 0) return MIN_WINDOW_MS;
  // Zero trackers is different in kind: not an unknown, but the domain fact
  // that nothing is reporting, so no window width can cost anything. The
  // default backfill is right here, and it means a fleet mapped later still
  // gets its cold start.
  if (!Number.isFinite(activeTrackers) || activeTrackers <= 0) return COLD_START_MS;
  const hours =
    (maxEventsPerFetch * BUDGET_UTILISATION) / (EVENTS_PER_HOUR_PER_VEHICLE * activeTrackers);
  // Floor to whole milliseconds: Date arithmetic is integer, so a fractional
  // window silently rounds and no longer matches what was computed. Floor
  // rather than round, so rounding can only ever spend less of the budget.
  return Math.max(Math.floor(hours * 60 * 60 * 1000), MIN_WINDOW_MS);
}

/**
 * Pull `from` forward if the window it implies is wider than the budget allows.
 *
 * Returns the clamped start plus what was given up, so the caller can say so
 * out loud. The history in that gap is not fetched on this tick, and past the
 * provider's retention it is gone: the watermark advances from what actually
 * landed, so nothing goes back for it. That is a real cost, and only ever the
 * better of two bad options — the unclamped alternative throws, which leaves
 * the watermark unset, so the next tick asks for the same oversized window and
 * throws again. One bounded gap beats ingesting nothing at all, forever.
 */
export function clampWindowStart(
  desiredFrom: Date,
  now: Date,
  maxWindowMs: number
): { from: Date; clampedMs: number } {
  const floor = new Date(now.getTime() - maxWindowMs);
  if (desiredFrom.getTime() >= floor.getTime()) return { from: desiredFrom, clampedMs: 0 };
  return { from: floor, clampedMs: floor.getTime() - desiredFrom.getTime() };
}

/**
 * The window for one tick: overlap back from the watermark, or a cold-start
 * backfill on first run, clamped to what the provider's budget can pay for.
 */
export function resolveWindow(opts: {
  last: Date | null;
  now: Date;
  maxEventsPerFetch: number;
  activeTrackers: number;
}): { from: Date; clampedMs: number; maxWindowMs: number } {
  const { last, now, maxEventsPerFetch, activeTrackers } = opts;
  const desiredFrom = last
    ? new Date(last.getTime() - OVERLAP_MS)
    : new Date(now.getTime() - COLD_START_MS);
  const maxWindowMs = maxWindowMsFor(maxEventsPerFetch, activeTrackers);
  const { from, clampedMs } = clampWindowStart(desiredFrom, now, maxWindowMs);
  return { from, clampedMs, maxWindowMs };
}
