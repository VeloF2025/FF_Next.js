/**
 * Vehicle-day stats backfill — the SAME build the 15-minute cron runs, looped.
 *
 * All of the logic lives in `src/modules/fleet/dailyStats/backfillRunner.ts`, which is tested;
 * this file is the shell that prints, locks and exits. Nothing here folds, computes or writes.
 *
 * Run:
 *   DATABASE_URL=... npx tsx scripts/fleet-daily-stats-backfill.ts
 *   DATABASE_URL=... npx tsx scripts/fleet-daily-stats-backfill.ts --max-passes 10
 *   DATABASE_URL=... npx tsx scripts/fleet-daily-stats-backfill.ts --vehicle <uuid>
 *   DATABASE_URL=... npx tsx scripts/fleet-daily-stats-backfill.ts --vehicle <uuid> --refold-day 2026-08-14
 *
 * Exits 1 when a vehicle failed, when backlog outlived the pass ceiling, when migration 528 is
 * missing, or when another daily-stats run holds the lock.
 */
import { runWithCronLock } from '../src/modules/fleet/incidents/cronLock';
import {
  assertSchemaReady, parseBackfillArgs, runBackfill,
} from '../src/modules/fleet/dailyStats/backfillRunner';
import { DAILY_STATS_LOCK } from '../src/modules/fleet/dailyStats/dailyStatsBuildService';

/**
 * Output for a CLI report tool.
 *
 * The zero-tolerance gate forbids `console.*` in changed files and offers
 * `eslint-disable-next-line no-console` as the sanctioned exception. This is one of the cases it
 * exists for -- the whole purpose of this script is a human-readable progress table -- and the
 * exception is declared ONCE per stream, exactly as `fleet-trips-backfill.ts` does it.
 */
function report(line: string): void {
  // eslint-disable-next-line no-console -- CLI report output; see the comment above
  console.log(line);
}

function fail(line: string): void {
  // eslint-disable-next-line no-console -- CLI error output; see the comment above
  console.error(line);
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  // Before the lock: a missing table is an operator error, not a concurrency one, and the message
  // must not be swallowed by "another run holds the lock".
  await assertSchemaReady();

  const startedAt = Date.now();
  // The SAME advisory lock the cron takes. Without it a 15-minute tick and this run fold the same
  // vehicle concurrently and race each other's watermark writes; held for the whole backfill
  // rather than per pass, so a tick fires and skips instead of interleaving between passes.
  const outcome = await runWithCronLock(DAILY_STATS_LOCK, () => runBackfill(args, report));
  if (!outcome.ran) {
    fail('another fleet-daily-stats run holds the lock — refusing to build concurrently. Retry once it ends.');
    process.exit(1);
  }

  const result = outcome.result;
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  report(`\ndone: ${result.daysWritten} vehicle-day rows over ${result.passes} pass(es) in ${seconds}s`);
  process.exit(result.exitCode);
}

main().catch((e: unknown) => { fail(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1); });
