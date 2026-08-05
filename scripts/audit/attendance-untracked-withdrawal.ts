#!/usr/bin/env node
/**
 * Untracked-expectation withdrawal — operator-run, dry-run by default.
 *
 * Withdraws attendance exceptions (and their paired phantom absence_review
 * summaries) that were raised against staff who are not attendance_tracked.
 * Those rows are unreachable by the reconciler — see
 * src/services/attendance/remediation/untrackedExpectationWithdrawal.ts for why
 * both rows have to go and why the exception is cancelled while the summary is
 * deleted.
 *
 * Run this after opting anyone OUT of attendance tracking, and after any change
 * that removes a staff member from the expected universe while their exceptions
 * are still open.
 *
 * Deliberately NOT a migration: scripts/deploy-local-main.sh applies pending
 * migrations on every deploy against the single shared dev+prod database, so a
 * routine daytime dev deploy would withdraw production attendance rows
 * unattended.
 *
 * Usage:
 *   # 1. Look. Writes nothing. Always start here.
 *   npx tsx scripts/audit/attendance-untracked-withdrawal.ts
 *
 *   # 2. Withdraw. --expect pins how many rows the dry run showed; --digest pins
 *   #    WHICH ones, so a same-size different-membership swap aborts too.
 *   npx tsx scripts/audit/attendance-untracked-withdrawal.ts --apply --expect=53 --digest=1a2b3c4d5e6f
 *
 *   # Reverse ONE run — restores its summaries and reopens its exceptions.
 *   # --run defaults to the most recent apply; pass it explicitly to be sure.
 *   npx tsx scripts/audit/attendance-untracked-withdrawal.ts --rollback --run=<uuid>
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
  process.stderr.write('[untracked-withdrawal] NODE_ENV=production but .env.production missing — refusing\n');
  process.exit(2);
}
// .env.production is loaded ONLY under NODE_ENV=production. Loading it
// unconditionally (and first, ahead of .env.local) means a stray .env.production
// in the checkout silently decides which database a "local" dry run targets.
// That is masked today because dev and prod share one physical database, but
// nothing enforces that and this tool deletes payroll-adjacent rows.
if (isProd) dotenv.config({ path: '.env.production' });
dotenv.config({ path: '.env.local', override: false });
if (!process.env.DATABASE_URL) {
  process.stderr.write('[untracked-withdrawal] DATABASE_URL not set — aborting\n');
  process.exit(2);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function value(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

if (flag('apply') && flag('rollback')) {
  process.stderr.write('[untracked-withdrawal] pick one mode: --apply or --rollback\n');
  process.exit(2);
}

(async () => {
  const { Pool } = await import('pg');
  const {
    planWithdrawal, applyWithdrawal,
  } = await import('../../src/services/attendance/remediation/untrackedExpectationWithdrawal');
  const {
    rollbackWithdrawal,
  } = await import('../../src/services/attendance/remediation/untrackedExpectationWithdrawalRollback');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  let exitCode = 0;
  try {
    if (flag('rollback')) {
      await client.query('BEGIN');
      const result = await rollbackWithdrawal(client, value('run'));
      await client.query('COMMIT');
      out(`run      : ${result.runId ?? '(none found)'}`);
      out(`restored : ${result.summariesRestored} summaries`);
      out(`reopened : ${result.exceptionsReopened} exceptions`);
      if (result.summariesRestored === 0 && result.exceptionsReopened === 0) {
        exitCode = 1;
        out('nothing was restored — no matching withdrawal run found in this database');
      }
      return;
    }

    const plan = await planWithdrawal(client);
    out(`withdrawable phantoms : ${plan.candidates.length}`);
    out(`distinct staff-days   : ${plan.summaryCount}`);
    out(`staff affected        : ${plan.staffCount}`);
    out(`date range            : ${plan.firstDate ?? '-'} .. ${plan.lastDate ?? '-'}`);
    out(`candidate set digest  : ${plan.digest}`);
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
      process.stderr.write('\n[untracked-withdrawal] refusing to apply while blockers exist. ' +
        'Each one is a row carrying evidence this remediation must not discard ' +
        '(a locked payroll week, a cited entry or adjustment, a real clock-in, ' +
        'a classification, or an approval). Resolve them first.\n');
      return;
    }
    const expected = value('expect');
    if (expected === undefined) {
      exitCode = 2;
      process.stderr.write('\n[untracked-withdrawal] --apply requires --expect=<count> matching the ' +
        'dry run. Without it a silent drift in the data changes what gets mutated.\n');
      return;
    }
    if (Number(expected) !== plan.candidates.length) {
      exitCode = 2;
      process.stderr.write(`\n[untracked-withdrawal] --expect=${expected} but ${plan.candidates.length} ` +
        'rows are eligible now. The data changed since you looked — re-run the dry run.\n');
      return;
    }
    // A count alone cannot detect a same-size, different-membership swap: three
    // candidates resolved by supervisors while three new ones are raised still
    // totals the same, and the operator would be applying to a set they never
    // reviewed. The digest pins WHICH rows, so the documented promise that
    // "drift since you looked aborts the run" is actually true.
    const digest = value('digest');
    if (digest === undefined) {
      exitCode = 2;
      process.stderr.write('\n[untracked-withdrawal] --apply requires --digest=<value> from the ' +
        'dry run. --expect pins how many rows; only the digest pins which ones.\n');
      return;
    }
    if (digest !== plan.digest) {
      exitCode = 2;
      process.stderr.write(`\n[untracked-withdrawal] --digest=${digest} but the eligible set now ` +
        `hashes to ${plan.digest}. Same count, different rows — re-run the dry run.\n`);
      return;
    }

    await client.query('BEGIN');
    const result = await applyWithdrawal(client, plan.candidates);
    await client.query('COMMIT');
    out(`\nrun id    : ${result.runId}`);
    out(`audited   : ${result.exceptionEventsWritten} exception events, ` +
      `${result.summaryEventsWritten} summary events`);
    out(`cancelled : ${result.exceptionsCancelled} exceptions`);
    out(`deleted   : ${result.summariesDeleted} phantom summaries`);
    out(`\nReverse THIS run with:  --rollback --run=${result.runId}`);
    out('The deleted summaries are held verbatim in their decision events\' ' +
      'before_value, in a table whose trigger forbids UPDATE, DELETE and TRUNCATE.');
  } catch (error) {
    // A failed ROLLBACK is reported, never swallowed: it means the transaction
    // may still be open or the connection is gone, and the operator has to know
    // that before assuming the database is untouched.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      process.stderr.write(
        `[untracked-withdrawal] ROLLBACK ALSO FAILED: ${(rollbackError as Error).message}\n` +
        '[untracked-withdrawal] The transaction may not have been undone — inspect the ' +
        'database before re-running.\n');
    }
    exitCode = 1;
    process.stderr.write(`[untracked-withdrawal] ${(error as Error).message}\n`);
  } finally {
    client.release();
    await pool.end();
    process.exit(exitCode);
  }
})();
