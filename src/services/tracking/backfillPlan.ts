/**
 * The decisions a historical backfill makes, separated from the IO that acts
 * on them.
 *
 * scripts/backfill-tracking.ts is a top-level `main()` against a live portal,
 * so nothing in it was reachable from a test — including the parts most worth
 * testing. An off-by-one in the backward walk either loops forever or re-fetches
 * a boundary chunk, and a bad `--floor` used to exit 0 having done nothing. All
 * of that is decided here, in functions that touch neither the network nor the
 * database.
 */

/** Netstar caps one report at 31 days; other portals will differ. */
export interface WalkStep {
  from: Date;
  to: Date;
}

/**
 * Validate a date argument.
 *
 * Both failure modes were silent before. An unparseable value reached
 * `toISOString()` as a bare RangeError with no hint which argument was wrong;
 * a FUTURE floor made the walk's guard immediately false, so the script logged
 * "reached configured floor, totalInserted: 0" and exited 0 — a success message
 * for having done nothing at all.
 */
export function parseDateArg(name: string, raw: string, now: Date = new Date()): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`--${name}=${raw} is not a valid date`);
  }
  if (d.getTime() > now.getTime()) {
    throw new Error(`--${name}=${raw} is in the future`);
  }
  return d;
}

/**
 * The next chunk to fetch, walking BACKWARDS from `to`.
 *
 * Clamped at the floor so the last chunk is short rather than overshooting,
 * and `from` is always strictly before `to` for any `to > floor` — which is
 * what keeps the walk terminating.
 */
export function nextChunk(to: Date, floor: Date, maxMs: number): WalkStep {
  const from = new Date(Math.max(to.getTime() - maxMs, floor.getTime()));
  return { from, to };
}

/**
 * Keep walking?
 *
 * Retention is discovered rather than assumed: portals do not document how far
 * back the data goes, so the walk stops after `maxDryChunks` consecutive empty
 * chunks — or at the configured floor, whichever comes first.
 */
export function shouldContinue(
  to: Date, floor: Date, dryChunks: number, maxDryChunks: number
): boolean {
  return to.getTime() > floor.getTime() && dryChunks < maxDryChunks;
}

/** Consecutive-empty counter: any non-empty chunk resets it. */
export function countDry(previous: number, fetched: number): number {
  return fetched === 0 ? previous + 1 : 0;
}

/**
 * The command that picks up where a run stopped.
 *
 * Printed on every chunk, on failure, and on Ctrl-C. Re-running is safe for the
 * database — ingestPositions is idempotent — but NOT for the portal: without a
 * cursor, a restart re-issues every report job it already did, one per vehicle
 * per 31-day chunk, against a partner-owned account.
 */
export function resumeCommand(providerKey: string, floor: Date, cursor: Date): string {
  return `npx tsx scripts/backfill-tracking.ts --provider=${providerKey}`
    + ` --floor=${floor.toISOString()} --to=${cursor.toISOString()}`;
}
