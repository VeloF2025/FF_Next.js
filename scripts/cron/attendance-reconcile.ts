#!/usr/bin/env node
/**
 * Attendance reconcile cron — Phase 1b.
 *
 * Runs nightly. Two duties:
 *   1. Auto-close `status='open'` entries older than 16h (missing_clock_out).
 *   2. Compute + upsert attendance_daily_summaries for closed entries within
 *      the last 14 days that don't yet have a summary row.
 *
 * Usage:
 *   # standard nightly run (previous 14 days through today)
 *   npx tsx scripts/cron/attendance-reconcile.ts
 *
 *   # explicit range (e.g., month-end retro)
 *   npx tsx scripts/cron/attendance-reconcile.ts --from=2026-04-01 --to=2026-04-30
 *
 * VPS Cron Setup (02:45 SAST daily — after the backup at 02:00 and the
 * selfie-retention sweep at 02:30):
 *   45 2 * * * cd /home/velo/fibreflow-production && \
 *     /usr/bin/npx tsx scripts/cron/attendance-reconcile.ts \
 *     >> /home/velo/logs/attendance-reconcile.log 2>&1
 *
 * Output:
 *   - A small set of stderr trail lines (start / done / fatal) so the cron
 *     log file surfaces what happened on each run. The in-memory `log`
 *     buffer never flushes to stdout in production mode, so if we relied
 *     on it alone the cron would run silently on success.
 *   - Fine-grained events inside reconcile.ts still go to the in-memory
 *     logger — visible via the usual /api/system/logs path in the app.
 *
 * Exits non-zero ONLY on unrecoverable errors (missing DATABASE_URL, no
 * default rule seeded, top-level throw). Per-entry failures are counted
 * in the report and logged, but do not fail the run — a single bad row
 * must not block payroll for the rest of the company.
 *
 * Imports ordering matters: dotenv MUST run before we import modules that
 * instantiate the pg.Pool (db-pool.ts constructs the pool at module load).
 * We use dynamic imports below so the pool sees the resolved DATABASE_URL.
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';

function stderr(msg: string): void {
  process.stderr.write(`${new Date().toISOString()} ${msg}\n`);
}

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !fs.existsSync('.env.production')) {
  stderr(
    '[attendance-reconcile] NODE_ENV=production but .env.production missing — refusing to run'
  );
  process.exit(2);
}

dotenv.config({ path: '.env.production' });
dotenv.config({ path: '.env.local', override: false });

if (!process.env.DATABASE_URL) {
  stderr('[attendance-reconcile] DATABASE_URL not set — aborting');
  process.exit(2);
}

try {
  const dbHost = new URL(process.env.DATABASE_URL).host;
  stderr(`[attendance-reconcile] starting dbHost=${dbHost} isProd=${isProd}`);
} catch {
  // Malformed URL — let the actual DB call fail with a clearer pg error.
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

(async () => {
  const startedAt = Date.now();
  try {
    const { reconcile } = await import('../../src/services/attendance/reconcile');
    type Opts = Parameters<typeof reconcile>[0];
    const opts: Opts = {};
    const fromDate = parseArg('from');
    const toDate = parseArg('to');
    if (fromDate) opts.fromDate = fromDate;
    if (toDate) opts.toDate = toDate;

    const report = await reconcile(opts);
    stderr(
      `[attendance-reconcile] done ` +
        `scanned=${report.scannedFrom}..${report.scannedTo} ` +
        `autoClosed=${report.autoClosed} ` +
        `summaries=${report.summariesUpserted} ` +
        `skippedIncomplete=${report.summariesSkippedIncomplete} ` +
        `capViolations=${report.weeklyCapViolations} ` +
        `perEntryErrors=${report.errorsPerEntry.length} ` +
        `durationMs=${Date.now() - startedAt}`
    );
    if (report.errorsPerEntry.length > 0) {
      stderr(
        `[attendance-reconcile] failed entryIds=${report.errorsPerEntry
          .map((e) => e.entryId)
          .join(',')}`
      );
    }
    process.exit(0);
  } catch (err) {
    stderr(
      `[attendance-reconcile] fatal: ${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }`
    );
    process.exit(1);
  }
})();
