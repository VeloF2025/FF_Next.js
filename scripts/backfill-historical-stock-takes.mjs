#!/usr/bin/env node
/* eslint-env node */
/**
 * backfill-historical-stock-takes.mjs
 *
 * Materialises the historical physical counts (physical_stock_snapshots,
 * migration 495) as records in the OPERATIONAL stock_takes / stock_take_lines
 * tables so they appear in the procurement Takes tab.
 *
 * SAFETY: every record is written with status = 'historical'. The stock-take
 * action handler only ever writes stock_quants on the `approve` transition, and
 * approve requires status = 'pending_review' (start requires draft, complete
 * requires in_progress). A 'historical' take therefore cannot travel any path
 * that mutates live stock — it is a read-only reference record.
 *
 * One stock_take per (snapshot_date, source_tab); one stock_take_line per
 * counted (item, site) where the item exists in the catalog (stock_take_lines
 * requires a stock_item_id). Sites with no FF warehouse keep their label in
 * bin_location so the detail is not lost.
 *
 * Idempotent: deletes existing status='historical' takes (+ their lines) inside
 * the transaction, then re-derives from the snapshot table. Never touches
 * operational (non-historical) takes.
 *
 * Usage: DATABASE_URL=... node scripts/backfill-historical-stock-takes.mjs
 */
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL must be set');
  process.exit(2);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
// A stable per-(date,tab) reference + display name. 'DC' tabs get a distinct
// suffix so the two 31-May tabs (DC + Sites) never collide on the unique ref.
function tabMeta(iso, sourceTab) {
  const isDc = /\bdc\b/i.test(sourceTab);
  const compact = iso.replace(/-/g, '');
  return {
    ref: `ST-HIST-${compact}-${isDc ? 'DC' : 'SITE'}`,
    name: `Physical Count${isDc ? ' (DC)' : ''} — ${prettyDate(iso)}`,
  };
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const catalog = new Map(
    (await pool.query('SELECT id, item_code FROM stock_items WHERE is_active')).rows.map(
      (r) => [r.item_code, r.id]
    )
  );

  // All snapshot rows, grouped by (date, tab) in the caller.
  const { rows: snaps } = await pool.query(
    `SELECT snapshot_date::text AS snapshot_date, source_tab, site_label,
            warehouse_id, item_code, quantity
       FROM physical_stock_snapshots
      ORDER BY snapshot_date, source_tab`
  );

  const groups = new Map(); // key `${date}|${tab}` -> { date, tab, rows: [] }
  for (const s of snaps) {
    const key = `${s.snapshot_date}|${s.source_tab}`;
    if (!groups.has(key)) groups.set(key, { date: s.snapshot_date, tab: s.source_tab, rows: [] });
    groups.get(key).rows.push(s);
  }

  const client = await pool.connect();
  let takeCount = 0;
  let lineCount = 0;
  let skippedNoCatalog = 0;
  let skippedNoWarehouse = 0;
  try {
    await client.query('BEGIN');
    // Idempotent: clear prior historical takes only.
    await client.query(
      `DELETE FROM stock_take_lines WHERE stock_take_id IN
         (SELECT id FROM stock_takes WHERE status = 'historical')`
    );
    await client.query(`DELETE FROM stock_takes WHERE status = 'historical'`);

    for (const g of groups.values()) {
      const { ref, name } = tabMeta(g.date, g.tab);
      // Lines require a stock_item_id and a location. Skip items not in the
      // catalog, and sites with no FF warehouse (warehouse_id NULL) — the latter
      // would also collide on the (take, item, COALESCE(location_id)) unique
      // index. Both remain in physical_stock_snapshots for reference.
      skippedNoCatalog += g.rows.filter((r) => !catalog.has(r.item_code)).length;
      skippedNoWarehouse += g.rows.filter((r) => catalog.has(r.item_code) && !r.warehouse_id).length;
      const catalogued = g.rows.filter((r) => catalog.has(r.item_code) && r.warehouse_id);
      const distinctItems = new Set(catalogued.map((r) => r.item_code)).size;

      const takeRes = await client.query(
        `INSERT INTO stock_takes
           (reference_number, name, description, stock_take_type, count_method,
            status, scheduled_date, start_date, end_date,
            total_items, counted_items, variance_items, notes, created_at, updated_at)
         VALUES ($1,$2,$3,'full','physical','historical',$4::date,$4::date,$4::date,
                 $5,$5,0,$6, now(), now())
         RETURNING id`,
        [
          ref,
          name,
          'Imported from the weekly SharePoint physical stock-take workbook.',
          g.date,
          distinctItems,
          'Reference only — historical physical count. Does not adjust stock levels.',
        ]
      );
      const takeId = takeRes.rows[0].id;
      takeCount += 1;

      // Lines, batched. counted_quantity comes straight from the snapshot row.
      const B = 500;
      for (let i = 0; i < catalogued.length; i += B) {
        const batch = catalogued.slice(i, i + B);
        const vals = [];
        const params = [];
        batch.forEach((r, j) => {
          const o = j * 7;
          vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7}::date,'counted')`);
          params.push(takeId, catalog.get(r.item_code), r.warehouse_id, r.warehouse_id, r.site_label, r.quantity, g.date);
        });
        if (!vals.length) continue;
        await client.query(
          `INSERT INTO stock_take_lines
             (stock_take_id, stock_item_id, location_id, warehouse_id, bin_location,
              counted_quantity, counted_at, status)
           VALUES ${vals.join(',')}`,
          params
        );
        lineCount += batch.length;
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`Historical stock takes written: ${takeCount}`);
  console.log(`Historical stock-take lines written: ${lineCount}`);
  console.log(`Snapshot rows skipped (item not in catalog): ${skippedNoCatalog}`);
  console.log(`Snapshot rows skipped (site has no FF warehouse): ${skippedNoWarehouse}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
