#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';
import type { BackfillResult } from './backfill-types';

interface Opts {
  pool: Pool;
  source: 'pickings' | 'returns' | 'all';
  commit: boolean;
}

/**
 * Backfill D: Walk historical stock_pickings (status='done') and emit
 * an 'issued' event into stock_serial_events per picking line.
 *
 * Idempotent via the uq_sse_dedupe partial unique index on
 * (serial_id, source_table, source_id, event_type) WHERE source_id IS NOT NULL.
 * The ON CONFLICT clause must mirror this predicate exactly.
 */
async function backfillPickingEvents(pool: Pool, commit: boolean): Promise<number> {
  if (!commit) {
    const c = await pool.query(`
      SELECT COUNT(*) FROM stock_pickings sp
      JOIN stock_picking_lines spl ON spl.picking_id = sp.id
      WHERE sp.status = 'done'
        AND spl.stock_serial_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_serial_events e
          WHERE e.serial_id    = spl.stock_serial_id
            AND e.source_table = 'stock_pickings'
            AND e.source_id    = sp.id
            AND e.event_type   = 'issued')`);
    return Number(c.rows[0].count);
  }

  const r = await pool.query(`
    INSERT INTO stock_serial_events
      (serial_id, event_type, from_state, to_state, source_table,
       source_id, actor_staff_id, occurred_at, payload)
    SELECT spl.stock_serial_id,
           'issued',
           NULL,
           'issued',
           'stock_pickings',
           sp.id,
           sp.staff_id,
           COALESCE(sp.done_at, NOW()),
           jsonb_build_object('picking_type', sp.picking_type,
                              'backfilled', true)
    FROM stock_pickings sp
    JOIN stock_picking_lines spl ON spl.picking_id = sp.id
    WHERE sp.status = 'done'
      AND spl.stock_serial_id IS NOT NULL
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
    DO NOTHING
    RETURNING id`);
  return r.rowCount ?? 0;
}

/**
 * Backfill E: Walk historical stock_returns and emit a 'returned' event
 * into stock_serial_events per return line.
 *
 * All return rows are eligible regardless of status — the return itself
 * is the historical fact being recorded.
 */
async function backfillReturnEvents(pool: Pool, commit: boolean): Promise<number> {
  if (!commit) {
    const c = await pool.query(`
      SELECT COUNT(*) FROM stock_returns sr
      JOIN stock_return_lines srl ON srl.return_id = sr.id
      WHERE srl.stock_serial_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_serial_events e
          WHERE e.serial_id    = srl.stock_serial_id
            AND e.source_table = 'stock_returns'
            AND e.source_id    = sr.id
            AND e.event_type   = 'returned')`);
    return Number(c.rows[0].count);
  }

  const r = await pool.query(`
    INSERT INTO stock_serial_events
      (serial_id, event_type, from_state, to_state, source_table,
       source_id, actor_staff_id, occurred_at, payload)
    SELECT srl.stock_serial_id,
           'returned',
           NULL,
           'returned',
           'stock_returns',
           sr.id,
           sr.staff_id,
           sr.created_at,
           jsonb_build_object('disposition', srl.disposition,
                              'backfilled', true)
    FROM stock_returns sr
    JOIN stock_return_lines srl ON srl.return_id = sr.id
    WHERE srl.stock_serial_id IS NOT NULL
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
    DO NOTHING
    RETURNING id`);
  return r.rowCount ?? 0;
}

export async function backfillSerialEvents(opts: Opts): Promise<BackfillResult> {
  const { pool, source, commit } = opts;
  let total = 0;

  if (source === 'pickings' || source === 'all') {
    total += await backfillPickingEvents(pool, commit);
  }
  if (source === 'returns' || source === 'all') {
    total += await backfillReturnEvents(pool, commit);
  }

  log.info('backfill-events done', { source, commit, total });

  return commit
    ? { inserted: total, wouldInsert: 0 }
    : { inserted: 0, wouldInsert: total };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const sourceIdx = process.argv.indexOf('--source');
  const rawSource = sourceIdx >= 0 ? process.argv[sourceIdx + 1] : 'all';

  if (!['pickings', 'returns', 'all'].includes(rawSource)) {
    console.error(`--source must be one of: pickings, returns, all (got: ${rawSource})`);
    process.exit(1);
  }

  const source = rawSource as 'pickings' | 'returns' | 'all';
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillSerialEvents({ pool, source, commit });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
