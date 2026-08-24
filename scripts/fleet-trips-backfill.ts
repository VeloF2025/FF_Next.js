/**
 * One-off backfill of trips over the full position history.
 *
 * Deliberately the SAME code path as the cron -- buildTrips, looped -- rather than a second
 * implementation. A separate backfill routine is how the historical rows end up subtly different
 * from the live ones, and the difference is invisible until someone reports on both together.
 *
 * Safe to re-run and safe to interrupt: each pass replaces the window it rebuilds, and a vehicle's
 * watermark advances only as far as it actually got.
 *
 * `now` is wall clock here, and that is correct AS LONG AS windows are anchored at trip
 * boundaries. It was not always: when batches could end mid-journey, a fresh `new Date()` applied
 * to July data made `silentFor` astronomically over the timeout, so every batch edge landing
 * inside a trip closed it as `timeout` and split the journey -- excluding its first half from
 * every metric. With the window now anchored at the last trip's start, a trip is never evaluated
 * against `now` until the run reaches the true end of that vehicle's data, which is exactly when
 * wall clock IS the right question: is this vehicle still out, or did its tracker go quiet?
 *
 * Position history currently starts 2026-07-16, so this is roughly six weeks over 18 vehicles.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/fleet-trips-backfill.ts
 */
import { runWithCronLock } from '../src/modules/fleet/incidents/cronLock';
import { buildTrips, TRIP_BUILD_LOCK } from '../src/modules/fleet/trips/tripBuildService';

/**
 * Output for a CLI report tool.
 *
 * The zero-tolerance gate forbids `console.*` in changed files and offers
 * `eslint-disable-next-line no-console` as the sanctioned exception. This is one of the cases it
 * exists for: the entire purpose of this script is to print a human-readable table to a terminal,
 * and routing that through the structured application logger would emit JSON to a log sink rather
 * than a report to the operator running it.
 *
 * Funnelled through two helpers so the exception is declared ONCE per stream and is visible, not
 * repeated silently at every call site.
 */
function report(line: string): void {
  // eslint-disable-next-line no-console -- CLI report output; see the comment above
  console.log(line);
}

function fail(line: string): void {
  // eslint-disable-next-line no-console -- CLI error output; see the comment above
  console.error(line);
}


const MAX_PASSES = 100;

/**
 * Runs the whole backfill under the SAME advisory lock the cron takes.
 *
 * Without it the backfill and a 15-minute cron tick build concurrently, and the exclusion
 * constraint rejects the overlapping inserts. That much is loud and self-healing -- but the
 * recovery is NOT state-preserving: a later clean run settles on different history than it would
 * have, because the 6h lookback never reaches back to the windows the collision mangled. A
 * transient overlap during `migrate -> backfill -> enable cron` permanently rewrites history.
 *
 * The lock is held for the entire backfill rather than per pass, so a tick firing midway skips
 * instead of interleaving between passes.
 */
async function backfill(): Promise<void> {
  const startedAt = Date.now();
  let pass = 0;
  let totalTrips = 0;

  for (pass = 1; pass <= MAX_PASSES; pass += 1) {
    const now = new Date().toISOString();
    const result = await buildTrips(now);
    totalTrips += result.tripsWritten;

    report(
      `pass ${String(pass).padStart(3)}  ` +
      `vehicles ${result.vehiclesSucceeded}/${result.vehiclesRequested}  ` +
      `trips +${result.tripsWritten} (${totalTrips})  ` +
      `positions ${result.positionsProcessed}  ` +
      `backlog ${result.vehiclesWithBacklog}  ` +
      `status ${result.status}`,
    );

    if (result.status === 'failed') {
      fail('every vehicle failed — stopping rather than looping on a broken state');
      process.exit(1);
    }
    // Caught up when no vehicle is still holding backlog.
    //
    // NOT `positionsProcessed === 0`: that can never happen. `buildTrips` deliberately re-reads
    // the last 6 hours on every run so late-arriving positions are not stepped over, so each pass
    // consumes that tail again and rebuilds it -- identically, since a window is replaced rather
    // than accumulated. Waiting for zero looped until MAX_PASSES and then exited 1 with "re-run
    // to continue" on a backfill that had actually finished on pass 1: 100x the work and a false
    // failure signal, while the stored trips were correct the whole time.
    //
    // `vehiclesWithBacklog` is the real more-work flag: `buildTrips` loops batches internally per
    // vehicle until a short batch, so zero backlog means every vehicle reached its newest
    // position. Further passes are only needed when MAX_BATCHES_PER_VEHICLE capped someone.
    if (result.vehiclesWithBacklog === 0) break;
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  report(`\ndone: ${totalTrips} trips over ${Math.min(pass, MAX_PASSES)} pass(es) in ${seconds}s`);
  if (pass > MAX_PASSES) {
    // Genuinely incomplete: someone still had backlog when the ceiling hit.
    fail('hit the pass ceiling with backlog outstanding — re-run to continue');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const outcome = await runWithCronLock(TRIP_BUILD_LOCK, backfill);
  if (!outcome.ran) {
    fail('another trip build holds the lock — refusing to build concurrently. Retry once it ends.');
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e: unknown) => { fail(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1); });
