#!/usr/bin/env tsx
/**
 * Sprint E backfill — rename legacy stock_serials.status 'available' → 'in_stock'
 * and gap-fill a synthetic genesis 'received' event for any serial that still has
 * no lifecycle events afterwards.
 *
 * Runs ONCE during the Sprint E cutover window (Track 7), AFTER migration 387 has
 * installed the validate / emit / holder triggers and the transition matrix.
 * Until the cutover gate flips, mig 387 is unapplied, so --commit is only ever
 * exercised against a Docker-spun copy (see the PR for the smoke-test transcript);
 * the live run happens inside the cutover transaction.
 *
 * Design (verified against mig 387 + live data 2026-05-29):
 *  - NO ff.bypass_validation. 'available'→'in_stock' is a matrixed transition
 *    (event_type 'backfill_rename') and every 'available' serial has
 *    holder_id IS NULL, which the (in_stock, NULL) holder pair permits — so the
 *    validate + holder-validate triggers pass cleanly. Setting bypass would
 *    instead log one row per serial into stock_serial_lifecycle_violations
 *    (~34k spurious "violations") for a perfectly legal transition, and would
 *    NOT suppress the emit trigger (emit ignores bypass) — so it buys nothing.
 *  - The AFTER-UPDATE emit trigger (trg_stock_serial_status_emit_t) writes one
 *    'backfill_rename' event per renamed row, so the rename needs no manual event
 *    insert. ff.event_source_table tags those events with this backfill's id.
 *  - The manual gap-fill therefore only targets serials that STILL have zero
 *    events after the rename (e.g. 'activated' bulk seeds the rename never touched).
 *
 * Pre-flight guards abort before any write if the data breaks the no-bypass
 * assumptions (a retired status present, or an 'available' serial carrying a
 * holder_id). Dry-run by default; pass --commit to apply.
 *
 * tsx conventions: dotenv first; pg.Pool directly (the @/lib/db alias is not
 * resolved at runtime); process.stdout/stderr (the logger is silent under tsx
 * and console.* is lint-banned).
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from 'pg';

const SOURCE_TABLE = 'backfill_2026_05_28';

type CountRow = { count: string };

async function scalar(pool: Pool, sql: string): Promise<number> {
  const res = await pool.query<CountRow>(sql);
  const row = res.rows[0];
  if (row === undefined) throw new Error(`query returned no rows: ${sql}`);
  return Number(row.count);
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const out = (m: string) => process.stdout.write(m + '\n');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    process.stderr.write('DATABASE_URL is not set (expected in .env.local)\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    out(`Sprint E serial-lifecycle backfill — mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);

    // ---- Pre-flight counts + guards -------------------------------------
    const renameCandidates = await scalar(
      pool,
      `SELECT COUNT(*) FROM stock_serials WHERE status = 'available'`
    );
    out(`available → in_stock candidates: ${renameCandidates}`);

    const retired = await scalar(
      pool,
      `SELECT COUNT(*) FROM stock_serials WHERE status IN ('reserved','in_transit','in_repair')`
    );
    if (retired > 0) {
      out(
        `ABORT: ${retired} row(s) in retired statuses (reserved/in_transit/in_repair) — ` +
          `mig 387 drops these from the CHECK; triage manually first.`
      );
      process.exit(1);
    }

    // No-bypass safety net: every 'available' serial must have holder_id IS NULL,
    // else the (in_stock, NULL) holder pair would reject it after the rename.
    const availWithHolder = await scalar(
      pool,
      `SELECT COUNT(*) FROM stock_serials WHERE status = 'available' AND holder_id IS NOT NULL`
    );
    if (availWithHolder > 0) {
      out(
        `ABORT: ${availWithHolder} 'available' serial(s) carry a holder_id — the no-bypass ` +
          `rename to in_stock (holder_id must be NULL) would fail holder-validate. Triage first.`
      );
      process.exit(1);
    }

    // Gap-fill candidates = serials with zero events. The rename will give every
    // 'available' serial a backfill_rename event, so the post-rename gap-fill
    // only needs to cover the non-'available' remainder.
    const zeroEventTotal = await scalar(
      pool,
      `SELECT COUNT(*) FROM stock_serials ss
        WHERE NOT EXISTS (SELECT 1 FROM stock_serial_events e WHERE e.serial_id = ss.id)`
    );
    const zeroEventNonAvailable = await scalar(
      pool,
      `SELECT COUNT(*) FROM stock_serials ss
        WHERE ss.status <> 'available'
          AND NOT EXISTS (SELECT 1 FROM stock_serial_events e WHERE e.serial_id = ss.id)`
    );
    out(`serials with zero events (total): ${zeroEventTotal}`);
    out(`  └─ genesis gap-fill targets after rename (non-'available'): ${zeroEventNonAvailable}`);

    // stock_serials.created_at is nullable; stock_serial_events.occurred_at is
    // NOT NULL. Surface any gap-fill targets whose genesis would fall back to
    // NOW() so a cutover operator isn't surprised (0 on live 2026-05-29).
    const zeroEventNullCreated = await scalar(
      pool,
      `SELECT COUNT(*) FROM stock_serials ss
        WHERE ss.created_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM stock_serial_events e WHERE e.serial_id = ss.id)`
    );
    if (zeroEventNullCreated > 0) {
      out(`  └─ of which created_at IS NULL (genesis anchored at NOW()): ${zeroEventNullCreated}`);
    }

    if (!commit) {
      out('DRY-RUN complete. No rows written. Re-run with --commit to apply.');
      await pool.end();
      process.exit(0);
    }

    // ---- Apply (single transaction) -------------------------------------
    const client = await pool.connect();
    let renamed = 0;
    let gapFilled = 0;
    try {
      await client.query('BEGIN');
      // Tag emit-trigger events with this backfill's source id (txn-local). No bypass.
      await client.query(`SELECT set_config('ff.event_source_table', $1, true)`, [SOURCE_TABLE]);

      // 1. Rename. The AFTER-UPDATE emit trigger writes one 'backfill_rename'
      //    event per row (available→in_stock is in the transition matrix).
      const renameRes = await client.query(
        `UPDATE stock_serials SET status = 'in_stock', updated_at = NOW() WHERE status = 'available'`
      );
      renamed = renameRes.rowCount ?? 0;

      // 2. Gap-fill a genesis 'received' event for any serial that STILL has no
      //    events (e.g. 'activated' bulk seeds the rename never touched). This is
      //    a direct INSERT (not a status change) so no trigger fires. occurred_at
      //    anchors the event at the serial's genesis (created_at), falling back to
      //    NOW() because stock_serials.created_at is nullable while occurred_at is
      //    NOT NULL — a lone NULL created_at must not abort the cutover txn. The
      //    WHERE NOT EXISTS makes a re-run idempotent.
      const gapRes = await client.query(
        `INSERT INTO stock_serial_events
           (serial_id, event_type, from_state, to_state, source_table, payload, occurred_at)
         SELECT ss.id, 'received', NULL, ss.status, $1,
                jsonb_build_object('reason', 'sprint-E-backfill-no-prior-events'),
                COALESCE(ss.created_at, NOW())
           FROM stock_serials ss
          WHERE NOT EXISTS (SELECT 1 FROM stock_serial_events e WHERE e.serial_id = ss.id)`,
        [SOURCE_TABLE]
      );
      gapFilled = gapRes.rowCount ?? 0;

      await client.query('COMMIT');
    } catch (e) {
      // Preserve the original error: if ROLLBACK also fails (e.g. dropped
      // connection) log it but re-throw the root cause, not the rollback error.
      await client.query('ROLLBACK').catch((rbErr) => {
        process.stderr.write(
          `ROLLBACK also failed: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}\n`
        );
      });
      throw e;
    } finally {
      client.release();
    }
    out(`COMMIT done. renamed (available→in_stock): ${renamed}, genesis events gap-filled: ${gapFilled}`);

    // ---- Post-commit verification ---------------------------------------
    const remainingAvailable = await scalar(
      pool,
      `SELECT COUNT(*) FROM stock_serials WHERE status = 'available'`
    );
    const remainingZeroEvent = await scalar(
      pool,
      `SELECT COUNT(*) FROM stock_serials ss
        WHERE NOT EXISTS (SELECT 1 FROM stock_serial_events e WHERE e.serial_id = ss.id)`
    );
    // L5 invariant (reconcile-queries.sql @name latest_event_matches_status,
    // tolerance 0): the latest event's to_state must equal the current status.
    const statusDrift = await scalar(
      pool,
      `SELECT COUNT(*) AS count FROM (
         SELECT ss.id
           FROM stock_serials ss
           JOIN LATERAL (
             SELECT to_state FROM stock_serial_events
              WHERE serial_id = ss.id
              ORDER BY occurred_at DESC, recorded_at DESC, id DESC
              LIMIT 1
           ) latest ON TRUE
          WHERE ss.status <> latest.to_state
       ) d`
    );
    out(
      `verify: remaining 'available'=${remainingAvailable} (want 0), ` +
        `zero-event serials=${remainingZeroEvent} (want 0), ` +
        `latest_event_matches_status drift=${statusDrift} (want 0)`
    );
    if (remainingAvailable !== 0 || remainingZeroEvent !== 0 || statusDrift !== 0) {
      process.stderr.write('VERIFICATION FAILED — investigate before proceeding.\n');
      await pool.end();
      process.exit(1);
    }
    out('Verification PASSED.');
  } finally {
    await pool.end();
  }
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`backfill failed: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
