#!/usr/bin/env node
/**
 * Attendance Selfie Retention Cron — POPIA s14 compliance.
 *
 * Deletes attendance selfies (from VF Storage) whose associated entry's
 * clock_in_at is older than the retention window (default 90 days), and
 * nullifies the corresponding URL column on `attendance_entries`.
 *
 * Usage:
 *   # dry-run (no deletes, just log what would be deleted)
 *   npx tsx scripts/cron/attendance-selfie-retention.ts --dry-run
 *
 *   # production sweep
 *   npx tsx scripts/cron/attendance-selfie-retention.ts
 *
 * VPS Cron Setup (02:30 SAST daily, after the DB backup at 02:00):
 *   30 2 * * * cd /home/velo/fibreflow-production && \
 *     /usr/bin/npx tsx scripts/cron/attendance-selfie-retention.ts \
 *     >> /var/log/attendance-retention.log 2>&1
 *
 * Notes:
 *   - Uses `src/lib/db-pool` (pg.Pool) against self-hosted Supabase. Do NOT
 *     switch this to `@neondatabase/serverless` — the WASM driver is dead
 *     code post 2026-04-18 cutover.
 *   - Exits non-zero on a hard failure so cron alerting picks it up. A
 *     storage/DB failure on a single entry is counted in the report but
 *     does NOT fail the run; those are expected edge cases (orphaned file,
 *     already-nullified URL from a manual admin action, etc.).
 *   - Rate-limited via `maxEntries` (1000) so a backlog of old entries
 *     doesn't spend all night in the VF Storage endpoint.
 */

import * as dotenv from 'dotenv';
import { sweepExpiredSelfies, DEFAULT_RETENTION_DAYS } from '../../src/modules/attendance/portal/retentionUtils';

// Environment: .env.production in prod, .env.local for dev runs.
dotenv.config({ path: '.env.production' });
dotenv.config({ path: '.env.local', override: false });

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL not set — aborting retention sweep');
  process.exit(2);
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const retentionDaysArg = process.argv.find((a) => a.startsWith('--days='));
const retentionDays = retentionDaysArg
  ? Number.parseInt(retentionDaysArg.split('=')[1] ?? '', 10)
  : DEFAULT_RETENTION_DAYS;

if (!Number.isFinite(retentionDays) || retentionDays < 1) {
  // eslint-disable-next-line no-console
  console.error(`Invalid --days=${retentionDaysArg} — must be a positive integer`);
  process.exit(2);
}

(async () => {
  const startedAt = new Date();
  // eslint-disable-next-line no-console
  console.log(
    `[attendance-retention] starting sweep (days=${retentionDays}, dryRun=${dryRun}, at=${startedAt.toISOString()})`
  );

  try {
    const report = await sweepExpiredSelfies({ retentionDays, dryRun });
    const elapsedMs = Date.now() - startedAt.getTime();
    // eslint-disable-next-line no-console
    console.log(
      `[attendance-retention] done in ${elapsedMs}ms — scanned=${report.entriesScanned} ` +
      `inDeleted=${report.inSelfiesDeleted} outDeleted=${report.outSelfiesDeleted} ` +
      `storageFailures=${report.storageFailures} dbFailures=${report.dbFailures} ` +
      `dryRun=${report.dryRun}`
    );
    // Failure budget: if > 10% of scanned entries failed at storage or DB,
    // treat as an alert-worthy run so ops wakes up.
    const threshold = Math.max(5, Math.floor(report.entriesScanned * 0.1));
    if (report.storageFailures + report.dbFailures > threshold) {
      // eslint-disable-next-line no-console
      console.error(
        `[attendance-retention] failure rate above threshold (${threshold}); check logs`
      );
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[attendance-retention] sweep threw unhandled error', err);
    process.exit(1);
  }
})();
