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
 *     >> /var/log/attendance-reconcile.log 2>&1
 *
 * Exits non-zero ONLY on unrecoverable errors (missing DATABASE_URL, no
 * default rule seeded, top-level throw). Per-entry failures are counted in
 * the report and logged, but do not fail the run — a single bad row must
 * not block payroll for the rest of the company.
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { reconcile, type ReconcileOptions } from '../../src/services/attendance/reconcile';
import { log } from '../../src/lib/logger';

// In production, .env.production MUST exist — silently falling back to a
// dev .env.local on a prod box could write auto-closes + summaries to the
// wrong database. Fail loud instead.
const isProd = process.env.NODE_ENV === 'production';
if (isProd && !fs.existsSync('.env.production')) {
  log.error(
    '[attendance-reconcile] NODE_ENV=production but .env.production missing — refusing to run'
  );
  process.exit(2);
}

dotenv.config({ path: '.env.production' });
dotenv.config({ path: '.env.local', override: false });

if (!process.env.DATABASE_URL) {
  log.error('[attendance-reconcile] DATABASE_URL not set — aborting');
  process.exit(2);
}

// One-line fence against wrong-DB writes: surface the host we're about to
// write to so a deploy going to the wrong target is visible in the first
// log line of the run, not 30 minutes later when payroll gets a weird csv.
try {
  const dbHost = new URL(process.env.DATABASE_URL).host;
  log.info('[attendance-reconcile] starting', { dbHost, isProd });
} catch {
  // Malformed URL — let the actual DB call fail with a clearer pg error
  // than we could synthesize here.
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

const opts: ReconcileOptions = {};
const fromDate = parseArg('from');
const toDate = parseArg('to');
if (fromDate) opts.fromDate = fromDate;
if (toDate) opts.toDate = toDate;

(async () => {
  const startedAt = new Date();
  try {
    const report = await reconcile(opts);
    log.info('[attendance-reconcile] done', {
      scannedFrom: report.scannedFrom,
      scannedTo: report.scannedTo,
      autoClosed: report.autoClosed,
      summariesUpserted: report.summariesUpserted,
      summariesSkippedIncomplete: report.summariesSkippedIncomplete,
      weeklyCapViolations: report.weeklyCapViolations,
      perEntryErrors: report.errorsPerEntry.length,
      durationMs: Date.now() - startedAt.getTime(),
    });
    if (report.errorsPerEntry.length > 0) {
      log.warn('[attendance-reconcile] some entries failed — see error logs above', {
        failedEntryIds: report.errorsPerEntry.map((e) => e.entryId),
      });
    }
    process.exit(0);
  } catch (err) {
    log.error('[attendance-reconcile] fatal error', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  }
})();
