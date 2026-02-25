/**
 * One-off script: Import BOQs from Smartsheet into FibreFlow
 * Pulls 4 project sheets via Smartsheet API, matches item codes to stock_items,
 * inserts into boqs + boq_items tables.
 *
 * Run: node scripts/import-smartsheet-boqs.mjs
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
}

const SMARTSHEET_TOKEN = '5P89h6lyN0kJyeu1UlMks6NH7RCtyIj7P43FF';
const API = 'https://api.smartsheet.com/2.0';
const sql = neon(process.env.DATABASE_URL);

// Sheet ID → FibreFlow project UUID + name
const PROJECTS = [
  { sheetId: '8709845407453060', projectId: 'c7255076-1d2f-41ce-97bb-858b8c87ee27', name: 'Etwatwa' },
  { sheetId: '2031051388964740', projectId: '7003dc06-9af7-4a7c-bc6c-a177d77784f2', name: 'Mamelodi' },
  { sheetId: '7284379228262276', projectId: 'd3df9135-9aa3-415d-87b6-17cce547eb22', name: 'Thembisa POP 2' },
  { sheetId: '4345777636724612', projectId: '1de088dd-fe24-43fb-b8d3-94fca61ef91d', name: 'Thembisa POP 3' },
];

async function fetchSheet(sheetId) {
  const res = await fetch(`${API}/sheets/${sheetId}`, {
    headers: { Authorization: `Bearer ${SMARTSHEET_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Smartsheet API ${res.status}: ${await res.text()}`);
  return res.json();
}

function parseZAR(val) {
  if (!val) return 0;
  return parseFloat(String(val).replace(/[R\s,]/g, '')) || 0;
}

async function importProject({ sheetId, projectId, name }) {
  console.log(`\n📥 Fetching sheet for ${name}...`);
  const sheet = await fetchSheet(sheetId);

  // Find column indices by title
  const colIdx = {};
  for (const col of sheet.columns) {
    colIdx[col.title] = col.index;
  }

  const itemsCol     = colIdx['Items'];
  const boqCol       = colIdx['BOQ'];
  const unitPriceCol = colIdx['Planned BOQ unit Price'];
  const totalCol     = colIdx['Planned BOQ Total'];

  console.log(`   Columns found: Items=${itemsCol}, BOQ=${boqCol}, UnitPrice=${unitPriceCol}, Total=${totalCol}`);

  // Pre-load stock items for description lookup
  const stockItems = await sql`SELECT item_code, name, uom FROM stock_items WHERE is_active = true`;
  const stockMap = new Map(stockItems.map(s => [s.item_code.toUpperCase(), s]));

  // Parse rows — only include rows where BOQ quantity > 0
  const items = [];
  let lineNumber = 1;

  for (const row of sheet.rows) {
    const cells = row.cells;
    const itemCode   = cells[itemsCol]?.value ?? '';
    const quantity   = parseFloat(cells[boqCol]?.value) || 0;
    const unitPrice  = parseZAR(cells[unitPriceCol]?.value);
    const totalPrice = parseZAR(cells[totalCol]?.value);

    if (!itemCode || quantity <= 0) continue;

    const stock = stockMap.get(String(itemCode).toUpperCase().trim());
    const description = stock?.name ?? String(itemCode);
    const uom = stock?.uom ?? 'units';

    items.push({
      lineNumber: lineNumber++,
      itemCode: String(itemCode).trim(),
      description,
      quantity,
      unitPrice,
      totalPrice: totalPrice || quantity * unitPrice,
      uom,
      mappingStatus: stock ? 'mapped' : 'pending',
      mappingConfidence: stock ? 100 : 0,
    });
  }

  console.log(`   Rows with qty > 0: ${items.length}`);
  if (items.length === 0) {
    console.log(`   ⚠️  No items to import, skipping.`);
    return;
  }

  const totalValue = items.reduce((s, i) => s + i.totalPrice, 0);
  const mappedCount = items.filter(i => i.mappingStatus === 'mapped').length;

  // Insert BOQ record
  const boqRows = await sql`
    INSERT INTO boqs (
      project_id, title, version, status, import_source,
      item_count, mapped_items, unmapped_items, total_estimated_value,
      mapping_status, mapping_confidence, uploaded_by, uploaded_at
    ) VALUES (
      ${projectId},
      ${'BOQ - ' + name + ' - FiberTime'},
      ${'v1'},
      ${'active'},
      ${'smartsheet'},
      ${items.length},
      ${mappedCount},
      ${items.length - mappedCount},
      ${totalValue},
      ${mappedCount === items.length ? 'mapped' : 'partial'},
      ${Math.round((mappedCount / items.length) * 100)},
      ${'smartsheet-import'},
      ${new Date().toISOString()}
    )
    RETURNING id
  `;
  const boqId = boqRows[0].id;
  console.log(`   ✅ BOQ created: ${boqId}`);

  // Insert items in batches of 50
  let inserted = 0;
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    for (const item of batch) {
      await sql`
        INSERT INTO boq_items (
          boq_id, project_id, line_number, item_code, description,
          quantity, unit_price, total_price, uom,
          mapping_status, mapping_confidence
        ) VALUES (
          ${boqId}, ${projectId}, ${item.lineNumber}, ${item.itemCode}, ${item.description},
          ${item.quantity}, ${item.unitPrice}, ${item.totalPrice}, ${item.uom},
          ${item.mappingStatus}, ${item.mappingConfidence}
        )
      `;
    }
    inserted += batch.length;
    process.stdout.write(`\r   Inserting items: ${inserted}/${items.length}`);
  }

  console.log(`\n   ✅ ${items.length} items inserted | Mapped: ${mappedCount} | Total: R${totalValue.toLocaleString('en-ZA', {minimumFractionDigits:2})}`);
}

async function main() {
  console.log('🚀 FibreFlow Smartsheet BOQ Import');
  console.log('====================================');

  for (const project of PROJECTS) {
    try {
      await importProject(project);
    } catch (err) {
      console.error(`\n❌ Failed for ${project.name}:`, err.message);
    }
  }

  console.log('\n====================================');
  console.log('✅ Import complete. Run a BOQ query to verify.');
}

main();
