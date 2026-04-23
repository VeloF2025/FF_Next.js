#!/usr/bin/env node
/**
 * Cartrack GPS cross-check cron — Phase 2.
 *
 * Runs nightly AFTER attendance-reconcile (so auto-closed entries have
 * their clock_out_at populated before we hit Cartrack).
 *
 * Usage:
 *   # standard nightly run — processes yesterday's closed entries
 *   npx tsx scripts/cron/attendance-cartrack-reconcile.ts
 *
 *   # explicit range for backfill
 *   npx tsx scripts/cron/attendance-cartrack-reconcile.ts --from=2026-04-01 --to=2026-04-14
 *
 * VPS cron (03:00 SAST = 01:00 UTC, after attendance-reconcile at 02:45):
 *   0 3 * * * cd /home/velo/fibreflow-dev && \
 *     ./node_modules/.bin/tsx scripts/cron/attendance-cartrack-reconcile.ts \
 *     >> /home/velo/logs/attendance-cartrack-reconcile.log 2>&1
 *
 * Env vars required:
 *   - DATABASE_URL
 *   - CARTRACK_API_USER, CARTRACK_API_PASS, CARTRACK_BASE_URL
 *
 * Exits non-zero on config failure (missing env) or top-level throw.
 * Per-entry Cartrack fetch failures are counted in errorsPerEntry but do
 * not fail the run — a single vehicle with a stale Cartrack mapping must
 * not block the rest of the fleet's verifications.
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';

function stderr(msg: string): void {
  process.stderr.write(`${new Date().toISOString()} ${msg}\n`);
}

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !fs.existsSync('.env.production')) {
  stderr(
    '[cartrack-reconcile] NODE_ENV=production but .env.production missing — refusing to run'
  );
  process.exit(2);
}

dotenv.config({ path: '.env.production' });
dotenv.config({ path: '.env.local', override: false });

if (!process.env.DATABASE_URL) {
  stderr('[cartrack-reconcile] DATABASE_URL not set — aborting');
  process.exit(2);
}
if (!process.env.CARTRACK_BASE_URL || !process.env.CARTRACK_API_USER || !process.env.CARTRACK_API_PASS) {
  stderr(
    '[cartrack-reconcile] CARTRACK_BASE_URL / CARTRACK_API_USER / CARTRACK_API_PASS must all be set'
  );
  process.exit(2);
}

try {
  const dbHost = new URL(process.env.DATABASE_URL).host;
  const cartrackHost = new URL(process.env.CARTRACK_BASE_URL).host;
  stderr(
    `[cartrack-reconcile] starting dbHost=${dbHost} cartrack=${cartrackHost} isProd=${isProd}`
  );
} catch {
  // Malformed URL — let the actual call fail with a clearer error.
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

(async () => {
  const startedAt = Date.now();
  try {
    const { cartrackReconcile } = await import(
      '../../src/services/attendance/cartrackReconcile'
    );
    const { cartrackClientFromEnv } = await import(
      '../../src/services/tracking/cartrack/client'
    );
    const cartrack = cartrackClientFromEnv();

    type Opts = Parameters<typeof cartrackReconcile>[1];
    const opts: Opts = {};
    const fromDate = parseArg('from');
    const toDate = parseArg('to');
    if (fromDate) opts.fromDate = fromDate;
    if (toDate) opts.toDate = toDate;

    const report = await cartrackReconcile(cartrack, opts);
    stderr(
      `[cartrack-reconcile] done ` +
        `scanned=${report.scannedFrom}..${report.scannedTo} ` +
        `entries=${report.entriesConsidered} ` +
        `match=${report.rowsMatch} mismatch=${report.rowsMismatch} ` +
        `no_data=${report.rowsNoData} not_mapped=${report.rowsVehicleNotMapped} ` +
        `device_gps_off=${report.rowsDeviceGpsOff} ` +
        `skipped=${report.rowsSkipped} mismatchExceptions=${report.mismatchExceptionsRaised} ` +
        `perEntryErrors=${report.perEntryErrors.length} ` +
        `durationMs=${Date.now() - startedAt}`
    );
    if (report.perEntryErrors.length > 0) {
      stderr(
        `[cartrack-reconcile] failed entryIds=${report.perEntryErrors
          .map((e) => e.entryId)
          .join(',')}`
      );
    }
    process.exit(0);
  } catch (err) {
    stderr(
      `[cartrack-reconcile] fatal: ${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }`
    );
    process.exit(1);
  }
})();
