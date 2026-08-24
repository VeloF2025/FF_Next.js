/**
 * One-off backfill of trips over the full position history.
 *
 * Deliberately the SAME code path as the cron -- buildTrips, looped -- rather than a second
 * implementation. A separate backfill routine is how the historical rows end up subtly different
 * from the live ones, and the difference is invisible until someone reports on both together.
 *
 * Safe to re-run and safe to interrupt: every write is an upsert on (vehicle_id, ignition_on_at),
 * and each vehicle's watermark advances only as far as it actually got.
 *
 * Position history currently starts 2026-07-16, so this is roughly six weeks over 18 vehicles.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/fleet-trips-backfill.ts
 */
import { buildTrips } from '../src/modules/fleet/trips/tripBuildService';

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

async function main(): Promise<void> {
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
    // Caught up when nothing was consumed and nobody is still holding backlog.
    if (result.positionsProcessed === 0 && result.vehiclesWithBacklog === 0) break;
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  report(`\ndone: ${totalTrips} trips over ${pass} pass(es) in ${seconds}s`);
  if (pass > MAX_PASSES) fail('hit the pass ceiling — re-run to continue');
}

main().then(() => process.exit(0)).catch((e: unknown) => { fail(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1); });
