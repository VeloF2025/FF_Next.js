#!/usr/bin/env node
/**
 * Holder auto-block sweep cron — Tier 3.2 (SOP-4.4).
 *
 * Runs the proactive holder auto-block sweep: blocks every holder whose
 * `aged_no_evidence` serials (mig 410 view) cross the `stock_accountability_config`
 * policy threshold (mig 411). No-op when the policy is disabled (the default), so
 * this is safe to schedule immediately — it does nothing until an admin arms the
 * policy.
 *
 * Usage:
 *   npx tsx scripts/cron/holder-auto-block-sweep.ts
 *
 * INERT until added to a crontab. Suggested VPS cron (daily 06:00 SAST — after the
 * nightly OES/WA syncs that feed the activation evidence the sweep cross-checks):
 *   0 6 * * * cd /home/velo/fibreflow-production && \
 *     /usr/bin/npx tsx scripts/cron/holder-auto-block-sweep.ts \
 *     >> /home/velo/logs/holder-auto-block-sweep.log 2>&1
 *
 * Output: stderr trail lines (start / done / fatal) for the cron log file — the
 * in-memory app logger does not flush to stdout in production, so success would be
 * silent otherwise. Exits 0 on success, 1 on top-level throw, 2 on missing config.
 *
 * Imports ordering matters: dotenv MUST run before importing db-pool (it constructs
 * the pg.Pool at module load), so the pool sees the resolved DATABASE_URL. Hence the
 * dynamic imports inside the async IIFE.
 */
import * as fs from 'fs';
import * as dotenv from 'dotenv';

function stderr(msg: string): void {
  process.stderr.write(`${new Date().toISOString()} ${msg}\n`);
}

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !fs.existsSync('.env.production')) {
  stderr('[holder-auto-block-sweep] NODE_ENV=production but .env.production missing — refusing to run');
  process.exit(2);
}

dotenv.config({ path: '.env.production' });
dotenv.config({ path: '.env.local', override: false });

if (!process.env.DATABASE_URL) {
  stderr('[holder-auto-block-sweep] DATABASE_URL not set — aborting');
  process.exit(2);
}

try {
  const dbHost = new URL(process.env.DATABASE_URL).host;
  stderr(`[holder-auto-block-sweep] starting dbHost=${dbHost} isProd=${isProd}`);
} catch {
  // Malformed URL — let the actual DB call fail with a clearer pg error.
}

(async () => {
  const startedAt = Date.now();
  try {
    const { query } = await import('../../src/lib/db-pool');
    const { runAutoBlockSweep } = await import(
      '../../src/modules/procurement/field-stock/services/autoBlockSweep'
    );

    const result = await runAutoBlockSweep(query, 'auto-block:cron');
    stderr(
      `[holder-auto-block-sweep] done ` +
        `enabled=${result.enabled} ` +
        `evaluated=${result.evaluated} ` +
        `blocked=${result.blocked.length} ` +
        `alreadyBlocked=${result.alreadyBlocked} ` +
        `durationMs=${Date.now() - startedAt}`,
    );
    if (result.blocked.length > 0) {
      stderr(
        `[holder-auto-block-sweep] blocked holderIds=${result.blocked
          .map((b) => b.holderId)
          .join(',')}`,
      );
    }
    process.exit(0);
  } catch (err) {
    stderr(
      `[holder-auto-block-sweep] fatal: ${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }`,
    );
    process.exit(1);
  }
})();
