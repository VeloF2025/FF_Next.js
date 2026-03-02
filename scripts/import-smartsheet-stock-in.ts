#!/usr/bin/env tsx
/**
 * One-off Import: Smartsheet "Stock IN" → FibreFlow purchase_orders
 *
 * Fetches sheet 876851875499908, groups rows by PO Number,
 * matches suppliers/projects by name, and inserts into purchase_orders
 * + purchase_order_items.
 *
 * Idempotent: uses ON CONFLICT (external_po_number) DO UPDATE.
 *
 * Usage:
 *   npx tsx scripts/import-smartsheet-stock-in.ts
 *   npx tsx scripts/import-smartsheet-stock-in.ts --dry-run
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const SMARTSHEET_TOKEN = process.env.SMARTSHEET_API_TOKEN;
if (!SMARTSHEET_TOKEN) {
  // eslint-disable-next-line no-console
  console.error('SMARTSHEET_API_TOKEN is not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const SHEET_ID = '876851875499908';
const SS_API = 'https://api.smartsheet.com/2.0';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Types ───────────────────────────────────────────────────────────────────

interface SmartsheetCell {
  columnId: number;
  value?: string | number | boolean | null;
  displayValue?: string;
}

interface SmartsheetRow {
  id: number;
  rowNumber: number;
  cells: SmartsheetCell[];
}

interface SmartsheetColumn {
  id: number;
  title: string;
  type: string;
}

interface SmartsheetSheet {
  name: string;
  totalRowCount: number;
  columns: SmartsheetColumn[];
  rows: SmartsheetRow[];
}

interface POGroup {
  poNumber: string;
  rows: SmartsheetRow[];
}

interface SupplierRow {
  id: number;
  name: string;
  trading_name: string | null;
}

interface ProjectRow {
  id: string;
  project_name: string;
}

// ─── Smartsheet fetch ────────────────────────────────────────────────────────

async function fetchSheet(): Promise<SmartsheetSheet> {
  const url = `${SS_API}/sheets/${SHEET_ID}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SMARTSHEET_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Smartsheet API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<SmartsheetSheet>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildColumnMap(columns: SmartsheetColumn[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const col of columns) {
    map.set(col.title, col.id);
  }
  return map;
}

function cellValue(row: SmartsheetRow, colId: number | undefined): string | number | boolean | null {
  if (!colId) return null;
  const cell = row.cells.find(c => c.columnId === colId);
  return cell?.value ?? null;
}

function cellDisplay(row: SmartsheetRow, colId: number | undefined): string | null {
  if (!colId) return null;
  const cell = row.cells.find(c => c.columnId === colId);
  return (cell?.displayValue ?? cell?.value?.toString()) || null;
}

function toNumber(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

function toDate(val: unknown): string | null {
  if (!val) return null;
  const s = String(val);
  // Smartsheet dates come as YYYY-MM-DD or ISO strings
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes';
  return Boolean(val);
}

// ─── Smartsheet → FF supplier alias map ──────────────────────────────────────
// Smartsheet uses short names; FF has full registered names.
// Keys are lowercase Smartsheet names → FF supplier IDs.

const SUPPLIER_ALIASES: Record<string, number> = {
  'adendorff':        29, // ADENDORFF MACHINERY MART CC
  'agri development': 33, // AGRI DEVELOPMENT SUPPLIERS (PTY) LTD
  'averge':           17, // AVERGE TECHNOLOGIES (PTY) LTD
  'buco nelspruit':   34, // Buco Nelspruit
  'cfs':              18, // CABLE FEEDER SYSTEMS AFRICA CC
  'eurobyte':         19, // EUROBYTE TECHNOLOGY (PTY) LTD
  'fttx':             21, // FTTX AND ENERGY WAREHOUSE (PTY) LTD
  'lambda':           22, // LAMBDA TEST EQUIPMENT CC
  'lathoko':          35, // LATHOKO INDUSTRIAL (PTY) LTD
  'm4a':              23, // MANHOLES 4 AFRICA (PTY) LTD
  'neocom':           24, // NEOCOM SOLUTIONS (PTY) LTD
  'photonics':        25, // PHOTONICS FIBRE CABLING SOUTH AFRICA (PTY) LTD
  'rand safety':      36, // RAND SAFETY EQUIPMENT CC
  'rohcap':           26, // ROHCAP FIBRE MAINTENANCE (PTY) LTD
};

// ─── Lookup maps ─────────────────────────────────────────────────────────────

async function loadSuppliers(): Promise<Map<string, number>> {
  const rows = await sql`
    SELECT id, LOWER(name) as name, LOWER(COALESCE(trading_name, '')) as trading_name
    FROM suppliers
  ` as unknown as SupplierRow[];
  const map = new Map<string, number>();

  // Load DB names
  for (const r of rows) {
    map.set(String(r.name).toLowerCase(), r.id);
    if (r.trading_name) {
      map.set(String(r.trading_name).toLowerCase(), r.id);
    }
  }

  // Add hardcoded aliases (Smartsheet short names → FF IDs)
  for (const [alias, id] of Object.entries(SUPPLIER_ALIASES)) {
    map.set(alias, id);
  }

  return map;
}

async function loadProjects(): Promise<Map<string, string>> {
  const rows = await sql`
    SELECT id, LOWER(project_name) as project_name FROM projects
  ` as unknown as ProjectRow[];
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(String(r.project_name).toLowerCase(), String(r.id));
  }
  return map;
}

// ─── Status derivation ──────────────────────────────────────────────────────

function deriveStatus(
  cancelled: boolean,
  fullyBilled: boolean,
  items: Array<{ qtyOrdered: number; qtyReceived: number }>
): string {
  if (cancelled) return 'cancelled';
  if (fullyBilled) return 'closed';
  const allReceived = items.length > 0 && items.every(i => i.qtyReceived >= i.qtyOrdered && i.qtyOrdered > 0);
  const someReceived = items.some(i => i.qtyReceived > 0);
  if (allReceived) return 'received';
  if (someReceived) return 'partially_received';
  return 'sent';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // eslint-disable-next-line no-console
  console.log(`\n${'='.repeat(60)}`);
  // eslint-disable-next-line no-console
  console.log(`  Smartsheet Stock IN → FibreFlow PO Import${DRY_RUN ? ' (DRY RUN)' : ''}`);
  // eslint-disable-next-line no-console
  console.log(`${'='.repeat(60)}\n`);

  // 1. Fetch sheet
  // eslint-disable-next-line no-console
  console.log('Fetching Smartsheet...');
  const sheet = await fetchSheet();
  // eslint-disable-next-line no-console
  console.log(`  Sheet: "${sheet.name}" — ${sheet.rows.length} rows, ${sheet.columns.length} columns\n`);

  // 2. Build column ID map
  const colMap = buildColumnMap(sheet.columns);
  // eslint-disable-next-line no-console
  console.log('Column mapping:');
  for (const [title, id] of colMap) {
    // eslint-disable-next-line no-console
    console.log(`  ${title} → ${id}`);
  }
  // eslint-disable-next-line no-console
  console.log('');

  // Resolve expected column IDs
  const COL = {
    poNumber:      colMap.get('PO Number'),
    poDate:        colMap.get('PO Date'),
    supplier:      colMap.get('Supplier'),
    project:       colMap.get('Project'),
    department:    colMap.get('Department'),
    fullyBilled:   colMap.get('Fully Billed'),
    cancelled:     colMap.get('Cancelled'),
    eta:           colMap.get('ETA'),
    comments:      colMap.get('Comments'),
    totalExVat:    colMap.get('Total EX VAT'),
    totalInclVat:  colMap.get('Total INCL VAT'),
    item:          colMap.get('Item'),
    qty:           colMap.get('QTY'),
    unitPriceEx:   colMap.get('Unit Price Ex VAT'),
    stockReceived: colMap.get('Stock Received'),
  };

  // Warn on missing columns
  const missing = Object.entries(COL).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`WARNING: Missing columns: ${missing.join(', ')}`);
    // eslint-disable-next-line no-console
    console.warn('Available columns:', Array.from(colMap.keys()).join(', '));
  }

  // 3. Group rows by PO Number
  const poGroups = new Map<string, SmartsheetRow[]>();
  let skippedNoPoNum = 0;
  for (const row of sheet.rows) {
    const poNum = cellDisplay(row, COL.poNumber);
    if (!poNum || !poNum.trim()) {
      skippedNoPoNum++;
      continue;
    }
    const key = poNum.trim();
    if (!poGroups.has(key)) poGroups.set(key, []);
    poGroups.get(key)!.push(row);
  }

  // eslint-disable-next-line no-console
  console.log(`Grouped ${sheet.rows.length} rows into ${poGroups.size} POs (${skippedNoPoNum} rows without PO number skipped)\n`);

  // 4. Load lookup maps
  const supplierMap = await loadSuppliers();
  const projectMap = await loadProjects();
  // eslint-disable-next-line no-console
  console.log(`Loaded ${supplierMap.size} supplier name variants, ${projectMap.size} projects\n`);

  // 5. Process each PO
  let imported = 0;
  let updated = 0;
  let skippedCancelled = 0;
  let skippedNoSupplier = 0;
  const unmatchedSuppliers = new Set<string>();
  const unmatchedProjects = new Set<string>();

  for (const [poNumber, rows] of poGroups) {
    // Use first row for PO-level fields
    const firstRow = rows[0];
    const supplierName = cellDisplay(firstRow, COL.supplier)?.trim() || '';
    const projectName = cellDisplay(firstRow, COL.project)?.trim() || '';
    const department = cellDisplay(firstRow, COL.department)?.trim() || null;
    const fullyBilled = toBool(cellValue(firstRow, COL.fullyBilled));
    const cancelled = toBool(cellValue(firstRow, COL.cancelled));
    const poDate = toDate(cellValue(firstRow, COL.poDate));
    const eta = toDate(cellValue(firstRow, COL.eta));
    const comments = cellDisplay(firstRow, COL.comments)?.trim() || null;

    // Match supplier (required)
    const supplierId = supplierMap.get(supplierName.toLowerCase());
    if (!supplierId) {
      unmatchedSuppliers.add(supplierName);
      skippedNoSupplier++;
      continue;
    }

    // Match project (optional)
    const projectId = projectMap.get(projectName.toLowerCase()) || null;
    if (projectName && !projectId) {
      unmatchedProjects.add(projectName);
    }

    // Build items array
    const items = rows.map(row => {
      const desc = cellDisplay(row, COL.item)?.trim() || 'Item';
      const qtyOrdered = toNumber(cellValue(row, COL.qty));
      const unitPrice = toNumber(cellValue(row, COL.unitPriceEx));
      const qtyReceived = toNumber(cellValue(row, COL.stockReceived));
      return { desc, qtyOrdered, unitPrice, qtyReceived, rowId: row.id };
    });

    // Calculate totals from items
    const subtotal = items.reduce((s, i) => s + Math.round(i.qtyOrdered * i.unitPrice * 100) / 100, 0);
    const taxRate = 15;
    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

    // Derive status
    const status = deriveStatus(cancelled, fullyBilled, items);

    if (DRY_RUN) {
      // eslint-disable-next-line no-console
      console.log(`  [DRY] ${poNumber} | ${supplierName} | ${projectName || '(no project)'} | R${totalAmount.toFixed(2)} | ${status} | ${items.length} items`);
      imported++;
      continue;
    }

    // Upsert PO
    const poResult = await sql`
      INSERT INTO purchase_orders (
        po_number, external_po_number, status, supplier_id, project_id,
        department, order_date, expected_delivery_date, internal_notes,
        subtotal, tax_rate, tax_amount, total_amount,
        fully_billed, cancelled, smartsheet_row_id,
        payment_terms, currency, delivery_address, created_by,
        created_at, updated_at
      ) VALUES (
        ${poNumber}, ${poNumber}, ${status}, ${supplierId}, ${projectId},
        ${department}, ${poDate}, ${eta}, ${comments},
        ${subtotal}, ${taxRate}, ${taxAmount}, ${totalAmount},
        ${fullyBilled}, ${cancelled}, ${firstRow.id},
        'Net 30', 'ZAR', 'Smartsheet Import', 'smartsheet-import',
        NOW(), NOW()
      )
      ON CONFLICT (external_po_number) DO UPDATE SET
        status = EXCLUDED.status,
        supplier_id = EXCLUDED.supplier_id,
        project_id = EXCLUDED.project_id,
        department = EXCLUDED.department,
        order_date = EXCLUDED.order_date,
        expected_delivery_date = EXCLUDED.expected_delivery_date,
        internal_notes = EXCLUDED.internal_notes,
        subtotal = EXCLUDED.subtotal,
        tax_amount = EXCLUDED.tax_amount,
        total_amount = EXCLUDED.total_amount,
        fully_billed = EXCLUDED.fully_billed,
        cancelled = EXCLUDED.cancelled,
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted
    `;

    const poId = poResult[0].id;
    const wasInserted = poResult[0].inserted;

    if (wasInserted) {
      imported++;
    } else {
      updated++;
      // Delete old items on re-run before re-inserting
      await sql`DELETE FROM purchase_order_items WHERE purchase_order_id = ${poId}`;
    }

    // Insert items
    for (const item of items) {
      const lineTotal = Math.round(item.qtyOrdered * item.unitPrice * 100) / 100;
      const itemTax = Math.round(lineTotal * (taxRate / 100) * 100) / 100;

      await sql`
        INSERT INTO purchase_order_items (
          purchase_order_id, item_description, quantity_ordered,
          quantity_received, unit_price, tax_rate, tax_amount,
          total_price, uom, created_at
        ) VALUES (
          ${poId}, ${item.desc}, ${item.qtyOrdered},
          ${item.qtyReceived}, ${item.unitPrice}, ${taxRate}, ${itemTax},
          ${lineTotal}, 'ea', NOW()
        )
      `;
    }
  }

  // 6. Summary
  // eslint-disable-next-line no-console
  console.log(`\n${'='.repeat(60)}`);
  // eslint-disable-next-line no-console
  console.log('  IMPORT SUMMARY');
  // eslint-disable-next-line no-console
  console.log(`${'='.repeat(60)}`);
  // eslint-disable-next-line no-console
  console.log(`  Total PO groups:     ${poGroups.size}`);
  // eslint-disable-next-line no-console
  console.log(`  Imported (new):      ${imported}`);
  // eslint-disable-next-line no-console
  console.log(`  Updated (re-run):    ${updated}`);
  // eslint-disable-next-line no-console
  console.log(`  Skipped (no supplier): ${skippedNoSupplier}`);
  // eslint-disable-next-line no-console
  console.log(`  Skipped (no PO#):    ${skippedNoPoNum}`);

  if (unmatchedSuppliers.size > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n  UNMATCHED SUPPLIERS (${unmatchedSuppliers.size}):`);
    for (const name of unmatchedSuppliers) {
      // eslint-disable-next-line no-console
      console.log(`    - "${name}"`);
    }
  }

  if (unmatchedProjects.size > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n  UNMATCHED PROJECTS (${unmatchedProjects.size}) — imported with NULL project_id:`);
    for (const name of unmatchedProjects) {
      // eslint-disable-next-line no-console
      console.log(`    - "${name}"`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\n${'='.repeat(60)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    // eslint-disable-next-line no-console
    console.error('Import failed:', err);
    process.exit(1);
  });
