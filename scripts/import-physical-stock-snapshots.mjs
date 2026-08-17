#!/usr/bin/env node
/* eslint-env node */
/**
 * import-physical-stock-snapshots.mjs
 *
 * Backfills the physical_stock_snapshots table (migration 495) from Lizelle's
 * weekly "Site Stock Take" workbook (SharePoint export). Reference-only history;
 * it never touches stock_quants or the operational stock_takes tables.
 *
 * Each worksheet whose name looks like a stock-take ("... <day> <Month>") is
 * parsed. Site columns are identified by matching the header against a known
 * site vocabulary (positions vary week to week), so purchase-tracking columns
 * ("Purchased in Feb", "Booked Out", …) are ignored. warehouse_id/code and
 * in_ff_catalog are resolved against the live catalog at import time.
 *
 * Idempotent: upserts on (snapshot_date, source_tab, site_label, item_code).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/import-physical-stock-snapshots.mjs <workbook.xlsx>
 */
import XLSX from 'xlsx';
import pg from 'pg';

const workbookPath = process.argv[2];
if (!workbookPath) {
  console.error('Usage: node scripts/import-physical-stock-snapshots.mjs <workbook.xlsx>');
  process.exit(2);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL must be set');
  process.exit(2);
}

const norm = (s) => String(s == null ? '' : s).trim().replace(/[‘’]/g, "'");
const nkey = (s) => norm(s).toLowerCase().replace(/\s+/g, ' ');
const numOf = (v) =>
  typeof v === 'number' ? v : v == null || v === '' || isNaN(+v) ? 0 : +v;

// Header names that identify the item-code column.
const CODE_HEADERS = new Set(['item_code', 'free', 'item', 'stock item']);
// Aggregate/meta columns that are never a site.
const NON_SITE = new Set([
  'total', 'total qty', 'totaal soh', 'item_code', 'name', 'category',
  'zar total', 'zar item', 'item', 'free', 'stock item',
  'purchased in feb', 'purchased in march', 's o/h einde maart',
  'purchased', 'booked out', 'delivered to site',
]);
// Site header (normalised) -> FF warehouse code. null = no FF warehouse yet.
const SITE_TO_WHCODE = new Map([
  ['garsfontein', 'DC-GARST'],
  ['garsfontein (to be allocated)', 'DC-GARST'],
  ['dc', 'DC-GARST'],
  ['law', 'WH-Law'],
  ['lawley', 'WH-Law'],
  ['moa', 'WH-Moh'],
  ['mohadin', 'WH-Moh'],
  ['mam', 'WH-MamP1'],
  ['mamelodi p1', 'WH-MamP1'],
  ['etw', 'WH-ETW'],
  ['etwatwa', 'WH-ETW'],
  ['tem 1', 'WH-Tem1'],
  ['tembisa 1', 'WH-Tem1'],
  ['tem 2', 'WH-Tem2'],
  ['tem 3', 'WH-Tem3'],
  ['ivory park', 'WH-IP'],
  ["temb'elihle", 'WH-TBL'],
  ['tembelihle', 'WH-TBL'],
  ['tonga', 'WH-TAV'],
  ['grabouw', 'WH-GR'],
  ['phalaborwa - namakgale', 'WH-PHAN'],
  ['mafikeng', 'WH-MAF'],
  // Sites with no FF warehouse yet -> null (still recorded, warehouse unmapped).
  ['phalaborwa - ben farms', null],
  ['cradock', null],
  ['middelburg', null],
  ['botshobelo', null],
  ['tzaneen (metz)', null],
  ['malmesbury', null],
  ['barberton', null],
  ['protea south', null],
  ['kingsway', null],
  ['chief albert luthuli', null],
]);

// First three letters of the month name -> month number. Covers the short and
// long spellings that appear in the tabs (Feb, March, April, May, June, July, Aug).
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
// Parse "... 7 Aug", "DC stocktake 31 May", "Site Stock Take 31 March" -> ISO date (year 2026).
function parseDate(tabName) {
  const m = norm(tabName).match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (!m) return null;
  const day = +m[1];
  const key = m[2].toLowerCase();
  const month = MONTHS[key.slice(0, 3)];
  if (!month || day < 1 || day > 31) return null;
  return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(4, rows.length); i++) {
    const r = rows[i] || [];
    if (r.some((c) => CODE_HEADERS.has(nkey(c)))) return i;
  }
  return -1;
}

async function main() {
  const wb = XLSX.readFile(workbookPath);
  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  // Resolve catalog + warehouse ids once.
  const { rows: locRows } = await pool.query(
    "SELECT id, code FROM stock_locations WHERE code IS NOT NULL"
  );
  const whCodeToId = new Map(locRows.map((r) => [r.code, r.id]));
  const { rows: itemRows } = await pool.query(
    'SELECT item_code FROM stock_items WHERE is_active'
  );
  const catalog = new Set(itemRows.map((r) => r.item_code));

  const records = [];
  const tabReport = [];
  for (const tab of wb.SheetNames) {
    const snapshotDate = parseDate(tab);
    if (!snapshotDate) continue; // Sheet2 and any non-dated tab
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], {
      header: 1, raw: true, defval: null,
    });
    const hr = detectHeaderRow(rows);
    if (hr < 0) { tabReport.push([tab, 'no header', 0]); continue; }
    const hdr = rows[hr];
    const codeIdx = hdr.findIndex((c) => CODE_HEADERS.has(nkey(c)));
    const nameIdx = hdr.findIndex((c) => nkey(c) === 'name');
    const catIdx = hdr.findIndex((c) => nkey(c) === 'category');
    const priceIdx = hdr.findIndex((c) => nkey(c) === 'zar item');
    // Site columns: any header matching the site vocabulary.
    const siteCols = [];
    hdr.forEach((c, idx) => {
      const k = nkey(c);
      if (!k || NON_SITE.has(k)) return;
      if (SITE_TO_WHCODE.has(k)) {
        siteCols.push({ idx, label: norm(c), whCode: SITE_TO_WHCODE.get(k) });
      }
    });
    if (siteCols.length === 0) { tabReport.push([tab, 'no site columns', 0]); continue; }

    let emitted = 0;
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[codeIdx] == null || norm(r[codeIdx]) === '') continue;
      const itemCode = norm(r[codeIdx]);
      const itemName = nameIdx >= 0 ? norm(r[nameIdx]) : null;
      const category = catIdx >= 0 ? norm(r[catIdx]) : null;
      const unitCost = priceIdx >= 0 ? numOf(r[priceIdx]) : null;
      for (const s of siteCols) {
        const qty = numOf(r[s.idx]);
        if (!qty) continue; // only record non-zero counts
        const whCode = s.whCode;
        records.push({
          snapshotDate, sourceTab: tab, siteLabel: s.label,
          warehouseId: whCode ? whCodeToId.get(whCode) || null : null,
          warehouseCode: whCode,
          itemCode, itemName: itemName || null, category: category || null,
          quantity: qty,
          unitCost: unitCost || null,
          lineValue: unitCost ? +(qty * unitCost).toFixed(2) : null,
          inFfCatalog: catalog.has(itemCode),
        });
        emitted++;
      }
    }
    tabReport.push([tab, `${snapshotDate} · ${siteCols.length} sites`, emitted]);
  }

  // Upsert in batches.
  let written = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const B = 500;
    for (let i = 0; i < records.length; i += B) {
      const batch = records.slice(i, i + B);
      const vals = [];
      const params = [];
      batch.forEach((r, j) => {
        const o = j * 12;
        vals.push(
          `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12})`
        );
        params.push(
          r.snapshotDate, r.sourceTab, r.siteLabel, r.warehouseId, r.warehouseCode,
          r.itemCode, r.itemName, r.category, r.quantity, r.unitCost, r.lineValue, r.inFfCatalog
        );
      });
      await client.query(
        `INSERT INTO physical_stock_snapshots
           (snapshot_date, source_tab, site_label, warehouse_id, warehouse_code,
            item_code, item_name, category, quantity, unit_cost, line_value, in_ff_catalog)
         VALUES ${vals.join(',')}
         ON CONFLICT (snapshot_date, source_tab, site_label, item_code) DO UPDATE SET
           warehouse_id = EXCLUDED.warehouse_id,
           warehouse_code = EXCLUDED.warehouse_code,
           item_name = EXCLUDED.item_name,
           category = EXCLUDED.category,
           quantity = EXCLUDED.quantity,
           unit_cost = EXCLUDED.unit_cost,
           line_value = EXCLUDED.line_value,
           in_ff_catalog = EXCLUDED.in_ff_catalog`,
        params
      );
      written += batch.length;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log('Tab report:');
  for (const [t, info, n] of tabReport) console.log(`  ${t.padEnd(26)} ${String(info).padEnd(24)} rows=${n}`);
  console.log(`\nUpserted ${written} snapshot rows from ${tabReport.filter((r) => r[2] > 0).length} tabs.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
