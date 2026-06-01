#!/usr/bin/env tsx
/**
 * #1864 backfill — receive OES-active Nokia ONTs that were never recorded in
 * stock_serials.
 *
 * Some ONTs are reported Active in OES but have no stock_serials row (delivered
 * to the field without ever passing through an intake channel). This inserts
 * them as genesis `in_stock` rows (emitting the mig-387 `received` event) so the
 * serial register is complete. It does NOT fabricate `activated` rows — the OES
 * cascade (promoteOesActivatedSerials, mig-393 in_stock→activated) promotes them
 * to `activated` on the next OES import. This mirrors the audit's rule: fix the
 * intake, do not synthesise activation state.
 *
 * Idempotent: ON CONFLICT (stock_item_id, serial_number) DO NOTHING. Re-running
 * receives only serials still missing. Order-independent w.r.t. the SharePoint
 * sync — whichever runs first, the other picks up the remainder.
 *
 * Dry-run by default; pass --commit to apply.
 *
 * tsx conventions (see backfill-serial-lifecycle-status.ts): dotenv first;
 * pg.Pool directly (the @/lib aliases are not resolved at runtime); the genesis
 * INSERT + ff.event_* GUCs are inlined (cannot import the serialIntake service
 * across the alias); process.stdout/stderr (logger is silent under tsx).
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool, type PoolClient } from 'pg';

/** stock_items UUID for the FT Nokia ONT (matches ontSerialWorkbook.ts). */
const FT_ONT_ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';
const SOURCE_TABLE = 'oes_backfill_1864';
const CHUNK_SIZE = 500;

async function scalar(pool: Pool, sql: string): Promise<number> {
  const res = await pool.query<{ n: string }>(sql);
  return Number(res.rows[0]?.n ?? 0);
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
    // ---- Pre-flight: refuse to run unless the mig-387/393 matrix is present.
    const hasGenesis = await scalar(
      pool,
      `SELECT count(*)::int AS n FROM stock_serial_status_transitions
        WHERE from_state = '__new__' AND to_state = 'in_stock'`,
    );
    const hasPromotion = await scalar(
      pool,
      `SELECT count(*)::int AS n FROM stock_serial_status_transitions
        WHERE from_state = 'in_stock' AND to_state = 'activated'`,
    );
    if (hasGenesis === 0) {
      process.stderr.write('Pre-flight FAILED: mig 387 genesis transition (__new__→in_stock) missing — aborting.\n');
      process.exit(1);
    }
    if (hasPromotion === 0) {
      out('WARNING: mig 393 (in_stock→activated) not present — backfilled serials will not auto-promote until it is applied.');
    }

    // ---- Identify the gap set: OES-active ALCL% serials absent from stock.
    // Scope is ONT only: OES tracks Nokia ONT activations (ALCL serials); Gizzu
    // UPS units are not OES-tracked, so there is no OES-vs-stock gap to backfill
    // for them. Gizzu intake flows solely through the SharePoint sync / import.
    const { rows: gapRows } = await pool.query<{ serial: string }>(
      `SELECT DISTINCT upper(trim(oa.serial_number)) AS serial
         FROM oes_activations oa
        WHERE oa.serial_number ILIKE 'ALCL%'
          AND NOT EXISTS (
            SELECT 1 FROM stock_serials ss WHERE ss.serial_number = upper(trim(oa.serial_number))
          )
        ORDER BY 1`,
    );
    const serials = gapRows.map((r) => r.serial).filter((s) => s.length >= 10);

    out(`#1864 OES-active ONTs missing from stock_serials: ${serials.length}`);
    out(`sample: ${serials.slice(0, 8).join('  ')}`);

    if (serials.length === 0) {
      out('Nothing to backfill — gap is already closed.');
      return;
    }

    if (!commit) {
      out('');
      out(`DRY RUN — would receive ${serials.length} serials as in_stock (source_table='${SOURCE_TABLE}').`);
      out('Re-run with --commit to apply.');
      return;
    }

    // ---- Receive in transactional chunks, emitting one `received` event each.
    const reference = `OES backfill #1864 ${new Date().toISOString().split('T')[0]}`;
    let received = 0;
    for (let i = 0; i < serials.length; i += CHUNK_SIZE) {
      const chunk = serials.slice(i, i + CHUNK_SIZE);
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        // One source_id per chunk (UUID); GUCs persist for the whole txn.
        const sourceId = (await client.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0]!.id;
        await client.query(`SET LOCAL ff.event_source_table = ${client.escapeLiteral(SOURCE_TABLE)}`);
        await client.query(`SET LOCAL ff.event_source_id = ${client.escapeLiteral(sourceId)}`);
        for (const sn of chunk) {
          const res = await client.query(
            `INSERT INTO stock_serials
               (id, stock_item_id, serial_number, current_location_id,
                status, received_reference, received_date, condition)
             VALUES (gen_random_uuid(), $1, $2, NULL,
                'in_stock', $3, NOW(), 'new')
             ON CONFLICT (stock_item_id, serial_number) DO NOTHING`,
            [FT_ONT_ITEM_ID, sn, reference],
          );
          received += res.rowCount ?? 0;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      out(`  …received ${received}/${serials.length}`);
    }

    const remaining = await scalar(
      pool,
      `SELECT count(DISTINCT upper(trim(serial_number)))::int AS n
         FROM oes_activations
        WHERE serial_number ILIKE 'ALCL%'
          AND NOT EXISTS (
            SELECT 1 FROM stock_serials ss WHERE ss.serial_number = upper(trim(oes_activations.serial_number))
          )`,
    );
    out('');
    out(`COMMITTED — received ${received} serials. OES gap remaining: ${remaining}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`backfill failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
