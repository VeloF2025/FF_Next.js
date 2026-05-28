#!/usr/bin/env tsx
/**
 * One-shot cleanup for the 27-row drift surfaced by
 * `latest_event_matches_status` on 2026-05-28.
 *
 * Pattern A (19 rows): stock_serials.status='activated' but the most recent
 * event is `installed_at_drop` (to_state='installed') from source_table='drops'.
 * The status guard in trg_emit_serial_event_on_drop_install correctly refused
 * to regress the status — but the event row was still written. The events are
 * spurious; the canonical status is correct. DELETE the events.
 *
 * Pattern B (8 rows): stock_serials.status='installed' but the latest event is
 * `activated` (from oes_pp_data) and `installed_at_drop_id IS NULL`. The
 * cascadePpResolution backfill regressed status from 'activated' to 'installed'
 * silently. RESTORE status='activated' (OES is the activation oracle) and audit
 * each change in serial_change_history.
 *
 * Both passes are idempotent via tight WHERE clauses on the drift signature.
 *
 * Usage:
 *   tsx scripts/cleanup-serial-drift-2026-05-28.ts             # dry-run (default)
 *   tsx scripts/cleanup-serial-drift-2026-05-28.ts --commit    # actually write
 */
import { Pool } from 'pg';

const ACTOR = 'serial-drift-cleanup-2026-05-28';

interface PatternARow {
  event_id: string;
  serial_id: string;
  serial_number: string;
  current_status: string;
  occurred_at: string;
}

interface PatternBRow {
  serial_id: string;
  serial_number: string;
  drop_number: string | null;
  current_status: string;
  latest_event_state: string;
}

async function findPatternA(pool: Pool): Promise<PatternARow[]> {
  // Drift signature: status is post-install/terminal, but the LATEST event
  // (by occurred_at DESC, recorded_at DESC, id DESC) is installed_at_drop with
  // to_state='installed'. The new trigger guard (mig 386) prevents new ones.
  const r = await pool.query<PatternARow>(`
    WITH latest AS (
      SELECT DISTINCT ON (sse.serial_id)
             sse.id          AS event_id,
             sse.serial_id,
             sse.event_type,
             sse.to_state,
             sse.occurred_at
      FROM   stock_serial_events sse
      ORDER  BY sse.serial_id, sse.occurred_at DESC, sse.recorded_at DESC, sse.id DESC
    )
    SELECT l.event_id,
           l.serial_id,
           ss.serial_number,
           ss.status        AS current_status,
           l.occurred_at::text
    FROM   latest l
    JOIN   stock_serials ss ON ss.id = l.serial_id
    WHERE  l.event_type = 'installed_at_drop'
      AND  l.to_state   = 'installed'
      AND  ss.status   IN ('activated','faulty','scrapped','in_repair','returned')
    ORDER  BY l.occurred_at DESC
  `);
  return r.rows;
}

async function findPatternB(pool: Pool): Promise<PatternBRow[]> {
  // Drift signature: status='installed', latest event is 'activated', AND
  // installed_at_drop_id IS NULL (i.e. cascade backfilled metadata but no
  // trigger ever fired for this serial). Restore to 'activated'.
  const r = await pool.query<PatternBRow>(`
    WITH latest AS (
      SELECT DISTINCT ON (sse.serial_id)
             sse.serial_id,
             sse.event_type,
             sse.to_state
      FROM   stock_serial_events sse
      ORDER  BY sse.serial_id, sse.occurred_at DESC, sse.recorded_at DESC, sse.id DESC
    )
    SELECT ss.id                       AS serial_id,
           ss.serial_number,
           ss.installed_at_drop_number AS drop_number,
           ss.status                   AS current_status,
           l.to_state                  AS latest_event_state
    FROM   latest l
    JOIN   stock_serials ss ON ss.id = l.serial_id
    WHERE  l.event_type            = 'activated'
      AND  l.to_state              = 'activated'
      AND  ss.status               = 'installed'
      AND  ss.installed_at_drop_id IS NULL
  `);
  return r.rows;
}

async function applyPatternA(pool: Pool, rows: PatternARow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let deleted = 0;
  // One txn per row so the audit write is co-committed with the event delete.
  // Without an audit row the deletion is unrecoverable from the table itself,
  // so we record every targeted event in serial_change_history before removing it.
  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const d = await client.query(
        `DELETE FROM stock_serial_events WHERE id = $1`,
        [row.event_id],
      );
      if (d.rowCount && d.rowCount > 0) {
        await client.query(
          `INSERT INTO serial_change_history
             (drop_number, change_type, old_value, new_value,
              change_source, actor, change_reason, metadata)
           VALUES
             ('UNKNOWN', 'status', 'installed_event', 'deleted',
              'serial-drift-cleanup', $1,
              'spurious installed_at_drop event deletion',
              jsonb_build_object(
                'serial_id',      $2::text,
                'serial_number',  $3,
                'event_id',       $4::text,
                'current_status', $5,
                'occurred_at',    $6,
                'cleanup_run',    '2026-05-28'))`,
          [ACTOR, row.serial_id, row.serial_number, row.event_id, row.current_status, row.occurred_at],
        );
        deleted += 1;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return deleted;
}

async function applyPatternB(pool: Pool, rows: PatternBRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let updated = 0;
  // One txn per row so an audit write that fails doesn't block siblings,
  // and so the drop_number-keyed audit row is co-committed with the status flip.
  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query(
        `UPDATE stock_serials
            SET status     = 'activated',
                updated_at = NOW()
          WHERE id              = $1
            AND status          = 'installed'
            AND installed_at_drop_id IS NULL`,
        [row.serial_id],
      );
      if (u.rowCount && u.rowCount > 0) {
        await client.query(
          `INSERT INTO serial_change_history
             (drop_number, change_type, old_value, new_value,
              change_source, actor, change_reason, metadata)
           VALUES
             ($1, 'status', 'installed', 'activated',
              'serial-drift-cleanup', $2,
              'cascade silent regression revert',
              jsonb_build_object(
                'serial_id',      $3::text,
                'serial_number',  $4,
                'latest_event',   'activated',
                'oracle',         'oes_pp_data',
                'cleanup_run',    '2026-05-28'))`,
          [row.drop_number ?? 'UNKNOWN', ACTOR, row.serial_id, row.serial_number],
        );
        updated += 1;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return updated;
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL not set\n');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    const a = await findPatternA(pool);
    const b = await findPatternB(pool);

    process.stdout.write(`\nPattern A — spurious installed_at_drop events on activated/terminal serials\n`);
    process.stdout.write(`Count: ${a.length}\n`);
    for (const row of a) {
      process.stdout.write(
        `  serial=${row.serial_number} status=${row.current_status} event_id=${row.event_id} occurred=${row.occurred_at}\n`,
      );
    }

    process.stdout.write(`\nPattern B — status regressed to 'installed' on already-activated serials\n`);
    process.stdout.write(`Count: ${b.length}\n`);
    for (const row of b) {
      process.stdout.write(
        `  serial=${row.serial_number} status=${row.current_status} drop=${row.drop_number ?? '(none)'}\n`,
      );
    }

    if (!commit) {
      process.stdout.write(`\nDRY-RUN. Re-run with --commit to apply.\n`);
      return;
    }

    process.stdout.write(`\nApplying...\n`);
    const aDeleted = await applyPatternA(pool, a);
    const bUpdated = await applyPatternB(pool, b);
    process.stdout.write(`  Pattern A: deleted ${aDeleted} events (+ ${aDeleted} audit rows)\n`);
    process.stdout.write(`  Pattern B: reverted ${bUpdated} serials → 'activated' (+ ${bUpdated} audit rows)\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  process.stderr.write(`cleanup failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
