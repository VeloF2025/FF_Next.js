#!/usr/bin/env node
/**
 * Legacy auto-close remediation — operator-run, dry-run by default.
 *
 * Clears the fabricated clock-outs the pre-#2351 reconciler stamped onto
 * auto-closed entries (clock_in_at + a 9h cap, with the missing_clock_out
 * exception INSERT failing every time with 42P08 after the UPDATE had already
 * committed), and zeroes the legacy hour columns those clock-outs fed.
 *
 * Deliberately NOT a migration: scripts/deploy-local-main.sh applies pending
 * migrations on every deploy against the single shared dev+prod database, so a
 * routine daytime dev deploy would mutate production attendance — possibly
 * before the #2362 guard that makes a replay safe is live.
 *
 * Usage:
 *   # 1. Look. Writes nothing. Always start here.
 *   npx tsx scripts/audit/attendance-legacy-autoclose-reset.ts
 *
 *   # 2. Clear the fabricated evidence. Requires --expect to match the count
 *   #    the dry-run reported, so drift since you looked aborts the run.
 *   npx tsx scripts/audit/attendance-legacy-autoclose-reset.ts --apply --expect=607
 *
 *   # 3. SEPARATE, later step — open history to the reconciler. This is what
 *   #    puts exceptions into the review queue, including via the nightly
 *   #    cron's trailing 14-day window. Only run it when you are ready.
 *   npx tsx scripts/audit/attendance-legacy-autoclose-reset.ts --backdate-policy=2026-04-25
 *
 *   # Reverse either half.
 *   npx tsx scripts/audit/attendance-legacy-autoclose-reset.ts --rollback
 *   npx tsx scripts/audit/attendance-legacy-autoclose-reset.ts --restore-policy
 *
 * Exits non-zero on refusal or error so a wrapper cannot mistake a blocked run
 * for a clean one.
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';

function out(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !fs.existsSync('.env.production')) {
  process.stderr.write('[autoclose-reset] NODE_ENV=production but .env.production missing — refusing\n');
  process.exit(2);
}
dotenv.config({ path: '.env.production' });
dotenv.config({ path: '.env.local', override: false });
if (!process.env.DATABASE_URL) {
  process.stderr.write('[autoclose-reset] DATABASE_URL not set — aborting\n');
  process.exit(2);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function value(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

const MODES = ['apply', 'rollback', 'restore-policy'].filter(flag)
  .concat(value('backdate-policy') ? ['backdate-policy'] : []);
if (MODES.length > 1) {
  process.stderr.write(`[autoclose-reset] pick one mode; got: ${MODES.join(', ')}\n`);
  process.exit(2);
}

(async () => {
  const { Pool } = await import('pg');
  const {
    planRemediation, applyRemediation,
  } = await import('../../src/services/attendance/remediation/legacyAutocloseReset');
  const {
    rollbackRemediation, backdatePolicy, restorePolicy,
  } = await import('../../src/services/attendance/remediation/legacyAutocloseRollback');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  let exitCode = 0;
  try {
    const backdate = value('backdate-policy');
    if (backdate) {
      await client.query('BEGIN');
      const result = await backdatePolicy(client, backdate);
      await client.query('COMMIT');
      out(`policy ${result.policyId}: active_from ${result.previousActiveFrom} -> ${result.newActiveFrom}`);
      out('History is now visible to the reconciler. The nightly cron reconciles a');
      out('trailing 14-day window, so part of it will reproject unattended at 02:45 SAST.');
      return;
    }

    if (flag('restore-policy')) {
      await client.query('BEGIN');
      const result = await restorePolicy(client);
      await client.query('COMMIT');
      if (!result) { exitCode = 1; out('no policy backup found — nothing restored'); return; }
      out(`policy ${result.policyId}: active_from ${result.previousActiveFrom} -> ${result.newActiveFrom}`);
      return;
    }

    if (flag('rollback')) {
      await client.query('BEGIN');
      const result = await rollbackRemediation(client);
      await client.query('COMMIT');
      if (!result.applied) {
        exitCode = 1;
        out('backup tables absent — nothing was restored (the remediation was never applied here)');
        return;
      }
      out(`restored: ${result.entriesRestored} entries, ${result.summariesRestored} summaries, ` +
        `${result.notesStripped} notes stripped`);
      if (result.skippedChangedSummaries > 0) {
        out(`SKIPPED ${result.skippedChangedSummaries} summaries that no longer hold the zeroes ` +
          'this remediation wrote — they were recomputed since and were left untouched.');
      }
      return;
    }

    const plan = await planRemediation(client);
    out(`eligible fabricated closures : ${plan.candidates.length}`);
    out(`staff affected               : ${plan.staffCount}`);
    out(`date range                   : ${plan.firstDate ?? '-'} .. ${plan.lastDate ?? '-'}`);
    out(`fabricated paid hours        : ${plan.fabricatedHours.toFixed(2)} (regular + overtime)`);
    if (plan.withoutSummary > 0) {
      out(`  of which with no summary row: ${plan.withoutSummary} (clock-out cleared, nothing to zero)`);
    }
    if (plan.blockers.length > 0) {
      out(`\nBLOCKED (${plan.blockers.length}) — not eligible, and --apply will refuse:`);
      const byReason = new Map<string, number>();
      for (const b of plan.blockers) byReason.set(b.reason, (byReason.get(b.reason) ?? 0) + 1);
      for (const [reason, count] of [...byReason].sort()) out(`  ${reason}: ${count}`);
    }

    if (!flag('apply')) {
      out('\nDRY RUN — nothing was written. Re-run with --apply --expect=<count> to mutate.');
      return;
    }

    if (plan.blockers.length > 0) {
      exitCode = 2;
      process.stderr.write('\n[autoclose-reset] refusing to apply while blockers exist. ' +
        'Each one is a row the application itself would refuse to overwrite ' +
        '(locked payroll week, locked daily result, wage already computed, ' +
        'already projected, or a day shared with another entry). Resolve them first.\n');
      return;
    }
    const expected = value('expect');
    if (expected === undefined) {
      exitCode = 2;
      process.stderr.write('\n[autoclose-reset] --apply requires --expect=<count> matching the ' +
        'dry-run. Without it a silent drift in the data changes what gets mutated.\n');
      return;
    }
    if (Number(expected) !== plan.candidates.length) {
      exitCode = 2;
      process.stderr.write(`\n[autoclose-reset] --expect=${expected} but ${plan.candidates.length} ` +
        'rows are eligible now. The data changed since you looked — re-run the dry run.\n');
      return;
    }

    await client.query('BEGIN');
    const result = await applyRemediation(client, plan.candidates);
    await client.query('COMMIT');
    out(`\nbacked up : ${result.entriesBackedUp} entries, ${result.summariesBackedUp} summaries`);
    out(`cleared   : ${result.entriesCleared} entries`);
    out(`zeroed    : ${result.summariesZeroed} summaries`);
    if (result.summariesZeroed < result.entriesCleared) {
      out(`NOTE ${result.entriesCleared - result.summariesZeroed} entries were cleared without ` +
        'their summary being zeroed — those rows no longer hold the backed-up values ' +
        '(a stale backup from an earlier run, or hours recomputed since). Nothing was ' +
        'destroyed; inspect them before assuming the remediation is complete.');
    }
    out('\nThe policy has NOT been backdated. History stays invisible to the reconciler');
    out('until you run --backdate-policy=<YYYY-MM-DD> as a separate, deliberate step.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* the transaction may not be open */ }
    // Set before the write: if stderr is a dead pipe the write throws, and a
    // failed apply must never fall through to exit 0.
    exitCode = 1;
    process.stderr.write(`[autoclose-reset] failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  } finally {
    client.release();
    await pool.end();
    process.exit(exitCode);
  }
})();
