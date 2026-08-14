#!/usr/bin/env node
/**
 * Attendance reconcile cron — Phase 1b.
 *
 * Runs nightly over the previous SAST work date by default. It operationally
 * closes stale sessions without manufacturing clock-out evidence, then writes
 * schedule-policy projections, idempotent exceptions and durable run health.
 *
 * Usage:
 *   # standard nightly run (previous 14 days through yesterday in SAST)
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
 * Exit codes:
 *   0 — every day in the window projected cleanly
 *   1 — unrecoverable error; nothing can be trusted from this run
 *   2 — refused to start (missing .env.production or DATABASE_URL)
 *   3 — partial: some days failed, the rest projected. The failed day keys and
 *       their reasons are persisted on attendance_reconciliation_runs.
 *
 * Day failures do not block successful worker/date projections, but they do
 * make the run exit non-zero.
 *
 * NOTE: nothing consumes this exit code today. The installed crontab entry
 * redirects to the log file with no wrapper, and no MAILTO is set, so exit 3
 * is currently observed by nobody. A correct exit code is a precondition for
 * alerting, not alerting itself — wiring it up is a separate operational step
 * tracked on #2480.
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
        `systemClosed=${report.systemClosed} ` +
        `projectedDays=${report.projectedDays} ` +
        `unchangedDays=${report.unchangedDays} ` +
        `missingClockOut=${report.missingClockOutExceptions} ` +
        `missingClockIn=${report.missingClockInExceptions} skippedLocked=${report.skippedLockedDays} ` +
        `failedDays=${report.failedDayKeys.length} ` +
        `durationMs=${Date.now() - startedAt}`
    );
    if (report.failedDayKeys.length > 0) {
      stderr(
        `[attendance-reconcile] failedDayKeys=${report.failedDayKeys.join(',')}`
      );
      // Two consecutive nights of partial runs went unnoticed because this used
      // to exit 0 regardless (#2480). Code 3 distinguishes "some days failed,
      // the rest projected" from a fatal error (1) or a config refusal (2), so
      // a monitor can act on it once one is attached — see the header note.
      process.exit(3);
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
