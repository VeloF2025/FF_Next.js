#!/usr/bin/env node
/**
 * Comprehensive SmartSheet → FibreFlow Procurement Sync
 *
 * 1. Ingests Item Receipts with correct project_id
 * 2. Matches item codes to existing PO items via PO number
 * 3. Maps item codes to BOQ items where possible
 * 4. Downloads documents (Quote, PO, GRV, Supplier Invoice) for checklist
 *
 * Usage:
 *   node scripts/sync-smartsheet-comprehensive.js [--dry-run] [--limit=N] [--docs-only] [--data-only]
 *
 * Idempotent — uses notes='smartsheet:{attachmentId}' for doc dedup.
 */

const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
const SMARTSHEET_API_TOKEN = process.env.SMARTSHEET_API_TOKEN;
const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0';
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

const sql = neon(DATABASE_URL);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DOCS_ONLY = args.includes('--docs-only');
const DATA_ONLY = args.includes('--data-only');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : null;

// SmartSheet sheet IDs
const SHEETS = {
  ITEM_RECEIPTS: '8404664677519236',
  DELIVERY_NOTES: '84737013010308',
  QUOTE_APPROVAL: '1589086541270916',
};

// SmartSheet project name → FibreFlow project name mapping
const PROJECT_NAME_MAP = {
  'mamelodi p1': 'Mamelodi',
  'mamelodi': 'Mamelodi',
  'lawley': 'Lawley',
  'lawley ext': 'Lawley',
  'tembisa 1': 'Thembisa POP 1',
  'tembisa 2': 'Thembisa POP 2',
  'tembisa 3': 'Thembisa POP 3',
  'thembisa 1': 'Thembisa POP 1',
  'thembisa 2': 'Thembisa POP 2',
  'thembisa 3': 'Thembisa POP 3',
  'thembisa pop 1': 'Thembisa POP 1',
  'thembisa pop 2': 'Thembisa POP 2',
  'thembisa pop 3': 'Thembisa POP 3',
  'tonga a': 'Tonga',
  'tonga': 'Tonga',
  'etwatwa': 'Etwatwa',
  'mohadin': 'Mohadin',
  'grabouw': 'Grabouw',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeProjectName(raw) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return PROJECT_NAME_MAP[key] || null;
}

function normalizePONumber(raw) {
  if (!raw) return null;
  // Take first PO if comma/semicolon separated
  const first = raw.split(/[,;\/]/)[0].trim().toUpperCase();
  return first || null;
}

function inferDocType(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('quote') || lower.includes('rfq') || lower.includes('quotation')) return 'quote_pdf';
  if (lower.includes('purchase order') || lower.includes('po ') || lower.match(/^po\d/) || lower.includes('_po_') || lower.includes('po.pdf')) return 'purchase_order';
  if (lower.includes('invoice') || lower.includes('inv')) return 'invoice';
  if (lower.includes('grv') || lower.includes('goods rec') || lower.includes('receipt')) return 'delivery_note';
  if (lower.includes('delivery') || lower.includes('dn') || lower.includes('pod')) return 'delivery_note';
  return 'other';
}

function guessMimeType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// SmartSheet API
// ---------------------------------------------------------------------------
async function ssGet(path) {
  const res = await fetch(`${SMARTSHEET_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${SMARTSHEET_API_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SS API ${res.status}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

async function fetchSheet(sheetId) {
  return ssGet(`/sheets/${sheetId}`);
}

async function fetchRowAttachments(sheetId, rowId) {
  try {
    const data = await ssGet(`/sheets/${sheetId}/rows/${rowId}/attachments`);
    return data.data || [];
  } catch {
    return [];
  }
}

async function getAttachmentUrl(sheetId, attachmentId) {
  const data = await ssGet(`/sheets/${sheetId}/attachments/${attachmentId}`);
  return data.url;
}

// ---------------------------------------------------------------------------
// VF Storage upload
// ---------------------------------------------------------------------------
async function uploadToStorage(poId, filename, fileBuffer, mimeType) {
  const boundary = `----FormBoundary${Date.now().toString(16)}`;
  const storageName = `${poId}_${filename}`;

  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${storageName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);

  const response = await fetch(`${VF_STORAGE_URL}/upload/procurement/purchase_order`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length.toString(),
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Storage upload failed (${response.status}): ${errText.substring(0, 200)}`);
  }

  const result = await response.json();
  const storagePath = result.path || `procurement/purchase_order/${result.filename || storageName}`;
  return {
    url: `https://vf.fibreflow.app/storage/${storagePath}`,
    path: storagePath,
    size: result.size || fileBuffer.length,
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Data ingestion — Item Receipts → project_id, PO item matching, BOQ
// ---------------------------------------------------------------------------
async function syncItemReceiptData(stats) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 1: Item Receipt Data Ingestion');
  console.log('='.repeat(60));

  // Load lookups
  const projects = await sql`SELECT id, project_name FROM projects`;
  const projectMap = new Map();
  for (const p of projects) {
    projectMap.set(p.project_name.toLowerCase(), p.id);
  }
  console.log(`  Projects loaded: ${projects.length}`);

  const pos = await sql`
    SELECT id, external_po_number, project_id, po_number
    FROM purchase_orders
    WHERE external_po_number IS NOT NULL
  `;
  const poMap = new Map();
  for (const po of pos) {
    poMap.set(po.external_po_number.trim().toUpperCase(), po);
  }
  console.log(`  POs with external_po_number: ${pos.length}`);

  // Fetch Item Receipts sheet
  console.log('\n  Fetching Item Receipts sheet...');
  const sheet = await fetchSheet(SHEETS.ITEM_RECEIPTS);
  const columns = sheet.columns || [];
  const rows = sheet.rows || [];

  const colMap = new Map();
  for (const col of columns) colMap.set(col.title, col.id);

  const poColId = colMap.get('PO Number');
  const projectColId = colMap.get('Project');
  const itemColId = colMap.get('Item');
  const itemCodeColId = colMap.get('New Item Codes');
  const qtyColId = colMap.get('QTY Received');
  const valueColId = colMap.get('Receipt Line Value Incl VAT');
  const exVatColId = colMap.get('Receipt Ex VAT');
  const supplierColId = colMap.get('Supplier');
  const dateColId = colMap.get('Date Received');
  const invoiceColId = colMap.get('Invoice/Delivery Note Number');

  console.log(`  Rows: ${rows.length}`);
  console.log(`  Columns found: PO=${!!poColId} Project=${!!projectColId} Item=${!!itemColId} ItemCode=${!!itemCodeColId}`);

  // Parse rows
  let projectUpdates = 0;
  let boqMatches = 0;
  const projectPOUpdates = []; // { poId, projectId }

  for (const row of rows) {
    const cells = row.cells || [];
    const vals = {};
    for (const cell of cells) {
      if (cell.columnId === poColId) vals.poNumber = cell.value ? String(cell.value).trim() : null;
      if (cell.columnId === projectColId) vals.project = cell.value ? String(cell.value).trim() : null;
      if (cell.columnId === itemColId) vals.item = cell.value ? String(cell.value).trim() : null;
      if (cell.columnId === itemCodeColId) vals.itemCode = cell.value ? String(cell.value).trim() : null;
      if (cell.columnId === qtyColId) vals.qty = cell.value ? Number(cell.value) : null;
      if (cell.columnId === valueColId) vals.value = cell.value ? Number(cell.value) : null;
      if (cell.columnId === exVatColId) vals.exVat = cell.value ? Number(cell.value) : null;
      if (cell.columnId === supplierColId) vals.supplier = cell.value ? String(cell.value).trim() : null;
      if (cell.columnId === dateColId) vals.date = cell.value ? String(cell.value).trim() : null;
      if (cell.columnId === invoiceColId) vals.invoice = cell.value ? String(cell.value).trim() : null;
    }

    if (!vals.poNumber) continue;

    const normalizedPO = normalizePONumber(vals.poNumber);
    if (!normalizedPO) continue;

    const po = poMap.get(normalizedPO);
    if (!po) {
      // Try with PO prefix
      const withPrefix = poMap.get(`PO${normalizedPO}`) || poMap.get(`PO-${normalizedPO}`);
      if (!withPrefix) {
        stats.unmatchedPOs.add(vals.poNumber);
        continue;
      }
    }

    const matchedPO = po || poMap.get(`PO${normalizedPO}`) || poMap.get(`PO-${normalizedPO}`);
    if (!matchedPO) continue;

    // 1. Update project_id if PO doesn't have one
    if (!matchedPO.project_id && vals.project) {
      const ffProjectName = normalizeProjectName(vals.project);
      if (ffProjectName) {
        const projectId = projectMap.get(ffProjectName.toLowerCase());
        if (projectId) {
          projectPOUpdates.push({ poId: matchedPO.id, projectId, projectName: ffProjectName });
          matchedPO.project_id = projectId; // update in-memory so we don't dupe
        }
      }
    }

    stats.itemReceiptRows++;
  }

  // Apply project_id updates
  if (projectPOUpdates.length > 0 && !DRY_RUN) {
    console.log(`\n  Updating ${projectPOUpdates.length} POs with project_id...`);
    for (const upd of projectPOUpdates) {
      await sql`UPDATE purchase_orders SET project_id = ${upd.projectId}::uuid WHERE id = ${upd.poId}::uuid AND project_id IS NULL`;
      projectUpdates++;
    }
  } else if (projectPOUpdates.length > 0) {
    console.log(`  [DRY RUN] Would update ${projectPOUpdates.length} POs with project_id`);
    projectPOUpdates.slice(0, 10).forEach(u => console.log(`    ${u.poId} → ${u.projectName}`));
  }

  stats.projectUpdates = projectUpdates;
  stats.boqMatches = boqMatches;

  // 2. BOQ matching — link PO items to BOQ items where item_code matches
  console.log('\n  Running BOQ item matching...');
  const boqResult = await sql`
    WITH unlinked_poi AS (
      SELECT poi.id as poi_id, poi.item_code, poi.item_description, po.project_id
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      WHERE poi.boq_item_id IS NULL
        AND poi.item_code IS NOT NULL
        AND po.project_id IS NOT NULL
    ),
    boq_items_active AS (
      SELECT bi.id as boq_item_id, bi.item_code, b.project_id
      FROM boq_items bi
      JOIN boqs b ON b.id = bi.boq_id
      WHERE b.status = 'active'
        AND bi.item_code IS NOT NULL
    )
    SELECT u.poi_id, ba.boq_item_id
    FROM unlinked_poi u
    JOIN boq_items_active ba ON ba.project_id::text = u.project_id::text
      AND LOWER(TRIM(ba.item_code)) = LOWER(TRIM(u.item_code))
  `;

  if (boqResult.length > 0 && !DRY_RUN) {
    console.log(`  Linking ${boqResult.length} PO items to BOQ items...`);
    for (const match of boqResult) {
      await sql`UPDATE purchase_order_items SET boq_item_id = ${match.boq_item_id}::uuid WHERE id = ${match.poi_id}::uuid AND boq_item_id IS NULL`;
      boqMatches++;
    }
  } else {
    console.log(`  ${DRY_RUN ? '[DRY RUN] Would link' : 'Found'} ${boqResult.length} PO items to BOQ items`);
  }

  stats.boqMatches = boqMatches || boqResult.length;

  console.log(`\n  Phase 1 summary:`);
  console.log(`    Item receipt rows processed: ${stats.itemReceiptRows}`);
  console.log(`    PO project_id updates: ${projectPOUpdates.length}`);
  console.log(`    BOQ item matches: ${stats.boqMatches}`);
  console.log(`    Unmatched POs: ${stats.unmatchedPOs.size}`);
}

// ---------------------------------------------------------------------------
// Phase 2: Document sync — Download & link all docs for the 4-type checklist
// ---------------------------------------------------------------------------
async function syncDocuments(stats) {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 2: Document Sync (Quote, PO, GRV, Invoice)');
  console.log('='.repeat(60));

  // Load PO lookup
  const pos = await sql`
    SELECT id, external_po_number FROM purchase_orders WHERE external_po_number IS NOT NULL
  `;
  const poMap = new Map();
  for (const po of pos) {
    poMap.set(po.external_po_number.trim().toUpperCase(), po.id);
  }

  // Load already-synced for idempotency
  const synced = await sql`
    SELECT notes FROM procurement_documents WHERE notes LIKE 'smartsheet:%' AND is_active = true
  `;
  const syncedIds = new Set(synced.map(r => r.notes.split(' |')[0].trim()));
  console.log(`  Already synced: ${syncedIds.size} documents`);

  // Collect work items from all 3 sheets
  const sheetConfigs = [
    {
      name: 'Item Receipts', id: SHEETS.ITEM_RECEIPTS,
      poColumn: 'PO Number', docNameColumn: 'Invoice/Delivery Note Number',
      contextColumn: 'Supplier', defaultDocType: null,
    },
    {
      name: 'Delivery Note Register', id: SHEETS.DELIVERY_NOTES,
      poColumn: 'PROC - RECON VF PO#', docNameColumn: 'Delivery Note Number',
      contextColumn: null, defaultDocType: 'delivery_note',
    },
    {
      name: 'Quote Approval Register', id: SHEETS.QUOTE_APPROVAL,
      poColumn: 'PO Number', docNameColumn: 'Quote Number',
      contextColumn: null, defaultDocType: 'quote_pdf',
    },
  ];

  const workItems = [];

  for (const sheet of sheetConfigs) {
    console.log(`\n  --- ${sheet.name} ---`);
    const sheetData = await fetchSheet(sheet.id);
    const columns = sheetData.columns || [];
    const rows = sheetData.rows || [];

    const colMap = new Map();
    for (const col of columns) colMap.set(col.title, col.id);

    const poColId = colMap.get(sheet.poColumn);
    const docNameColId = sheet.docNameColumn ? colMap.get(sheet.docNameColumn) : null;
    const ctxColId = sheet.contextColumn ? colMap.get(sheet.contextColumn) : null;

    if (!poColId) {
      console.log(`  WARNING: PO column "${sheet.poColumn}" not found — skipping`);
      continue;
    }

    // Build row data lookup
    const rowLookup = new Map();
    for (const row of rows) {
      let poNumber = null, docName = null, context = null;
      for (const cell of row.cells || []) {
        if (cell.columnId === poColId && cell.value) poNumber = String(cell.value).trim();
        if (docNameColId && cell.columnId === docNameColId && cell.value) docName = String(cell.value).trim();
        if (ctxColId && cell.columnId === ctxColId && cell.value) context = String(cell.value).trim();
      }
      if (poNumber) rowLookup.set(row.id, { poNumber, docName, context });
    }
    console.log(`  Rows with PO: ${rowLookup.size}`);

    // Fetch row attachments — we need to get per-row
    // For efficiency, use the sheet-level attachment list
    let allAttachments = [];
    let page = 1;
    while (true) {
      const data = await ssGet(`/sheets/${sheet.id}/attachments?page=${page}&pageSize=100`);
      allAttachments.push(...data.data);
      if (data.data.length < 100) break;
      page++;
      await delay(50);
    }
    console.log(`  Attachments: ${allAttachments.length}`);

    let rowAtts = 0;
    for (const att of allAttachments) {
      if (att.parentType !== 'ROW') continue;
      rowAtts++;
      const rowData = rowLookup.get(att.parentId);
      if (!rowData) continue;

      const docType = sheet.defaultDocType || inferDocType(att.name);

      workItems.push({
        sheetId: sheet.id, sheetName: sheet.name,
        attachmentId: att.id, attachmentName: att.name,
        mimeType: att.mimeType || guessMimeType(att.name),
        poNumber: rowData.poNumber,
        docName: rowData.docName || att.name.replace(/\.[^/.]+$/, ''),
        context: rowData.context,
        docType,
      });
    }
    console.log(`  Row attachments: ${rowAtts}`);
  }

  console.log(`\n  Total work items: ${workItems.length}`);

  // Filter out already synced
  const toProcess = workItems.filter(item => !syncedIds.has(`smartsheet:${item.attachmentId}`));
  const limited = LIMIT ? toProcess.slice(0, LIMIT) : toProcess;
  console.log(`  New (not yet synced): ${toProcess.length}`);
  if (LIMIT) console.log(`  Processing limit: ${LIMIT}`);

  if (DRY_RUN) {
    // Show type distribution
    const typeDist = {};
    for (const item of toProcess) {
      typeDist[item.docType] = (typeDist[item.docType] || 0) + 1;
    }
    console.log('\n  [DRY RUN] Document type distribution:');
    Object.entries(typeDist).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`    ${t}: ${c}`));
    stats.docsSkipped = toProcess.length;
    return;
  }

  // Process each
  let processed = 0;
  for (const item of limited) {
    processed++;
    const dedupKey = `smartsheet:${item.attachmentId}`;

    const rawPO = normalizePONumber(item.poNumber);
    let poId = poMap.get(rawPO);
    if (!poId && rawPO && !rawPO.startsWith('PO')) {
      poId = poMap.get(`PO${rawPO}`) || poMap.get(`PO-${rawPO}`);
    }
    if (!poId) {
      stats.unmatchedPOs.add(item.poNumber);
      stats.docsSkipped++;
      continue;
    }

    try {
      const pct = Math.round((processed / limited.length) * 100);
      process.stdout.write(`\r  [${pct}%] ${stats.docsLinked}/${processed} - ${item.attachmentName.substring(0, 40).padEnd(40)}`);

      const downloadUrl = await getAttachmentUrl(item.sheetId, item.attachmentId);
      await delay(50);

      const fileResp = await fetch(downloadUrl);
      if (!fileResp.ok) throw new Error(`Download HTTP ${fileResp.status}`);
      const fileBuffer = Buffer.from(await fileResp.arrayBuffer());
      stats.docsDownloaded++;

      const { url, path, size } = await uploadToStorage(poId, item.attachmentName, fileBuffer, item.mimeType);
      stats.docsUploaded++;

      const notesValue = item.context ? `${dedupKey} | ${item.context}` : dedupKey;

      await sql`
        INSERT INTO procurement_documents (
          entity_type, entity_id, document_type, document_name,
          file_url, file_path, file_size, mime_type,
          uploaded_by, uploaded_by_name, notes, is_active
        ) VALUES (
          'purchase_order', ${poId}::uuid, ${item.docType}, ${item.docName},
          ${url}, ${path}, ${size}, ${item.mimeType},
          'system@fibreflow.app', 'SmartSheet Sync', ${notesValue}, true
        )
      `;
      stats.docsLinked++;
      await delay(100);
    } catch (error) {
      stats.errors.push({ attachment: item.attachmentName, po: item.poNumber, error: error.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Checklist gap report
// ---------------------------------------------------------------------------
async function reportChecklistGaps() {
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 3: Document Checklist Coverage Report');
  console.log('='.repeat(60));

  const coverage = await sql`
    SELECT
      p.project_name,
      COUNT(DISTINCT po.id) as total_pos,
      COUNT(DISTINCT CASE WHEN quote.id IS NOT NULL THEN po.id END) as has_quote,
      COUNT(DISTINCT CASE WHEN po_doc.id IS NOT NULL THEN po.id END) as has_po_doc,
      COUNT(DISTINCT CASE WHEN grv.id IS NOT NULL THEN po.id END) as has_grv,
      COUNT(DISTINCT CASE WHEN inv.id IS NOT NULL THEN po.id END) as has_invoice,
      COUNT(DISTINCT CASE WHEN quote.id IS NOT NULL AND grv.id IS NOT NULL AND inv.id IS NOT NULL THEN po.id END) as complete_3of4
    FROM purchase_orders po
    LEFT JOIN projects p ON p.id = po.project_id
    LEFT JOIN procurement_documents quote ON quote.entity_id = po.id AND quote.entity_type = 'purchase_order' AND quote.document_type = 'quote_pdf' AND quote.is_active = true
    LEFT JOIN procurement_documents po_doc ON po_doc.entity_id = po.id AND po_doc.entity_type = 'purchase_order' AND po_doc.document_type = 'purchase_order' AND po_doc.is_active = true
    LEFT JOIN procurement_documents grv ON grv.entity_id = po.id AND grv.entity_type = 'purchase_order' AND grv.document_type IN ('delivery_note', 'grv') AND grv.is_active = true
    LEFT JOIN procurement_documents inv ON inv.entity_id = po.id AND inv.entity_type = 'purchase_order' AND inv.document_type = 'invoice' AND inv.is_active = true
    GROUP BY p.project_name
    ORDER BY total_pos DESC
  `;

  console.log('\n  Project                | POs | Quote | PO Doc | GRV | Invoice | 3/4+');
  console.log('  ' + '-'.repeat(75));
  for (const r of coverage) {
    const name = (r.project_name || '(no project)').padEnd(22);
    console.log(`  ${name} | ${String(r.total_pos).padStart(3)} | ${String(r.has_quote).padStart(5)} | ${String(r.has_po_doc).padStart(6)} | ${String(r.has_grv).padStart(3)} | ${String(r.has_invoice).padStart(7)} | ${String(r.complete_3of4).padStart(4)}`);
  }

  // Overall checklist completion
  const overall = await sql`
    SELECT
      COUNT(DISTINCT po.id) as total,
      COUNT(DISTINCT po.id) FILTER (WHERE q.cnt > 0 AND g.cnt > 0 AND i.cnt > 0) as three_of_four,
      COUNT(DISTINCT po.id) FILTER (WHERE q.cnt > 0 AND p2.cnt > 0 AND g.cnt > 0 AND i.cnt > 0) as four_of_four
    FROM purchase_orders po
    LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM procurement_documents d WHERE d.entity_id = po.id AND d.document_type = 'quote_pdf' AND d.is_active = true) q ON true
    LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM procurement_documents d WHERE d.entity_id = po.id AND d.document_type = 'purchase_order' AND d.is_active = true) p2 ON true
    LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM procurement_documents d WHERE d.entity_id = po.id AND d.document_type IN ('delivery_note', 'grv') AND d.is_active = true) g ON true
    LEFT JOIN LATERAL (SELECT COUNT(*) as cnt FROM procurement_documents d WHERE d.entity_id = po.id AND d.document_type = 'invoice' AND d.is_active = true) i ON true
  `;
  const o = overall[0];
  console.log(`\n  Overall: ${o.total} POs | 3/4 complete: ${o.three_of_four} | 4/4 complete: ${o.four_of_four}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const startTime = Date.now();
  const stats = {
    itemReceiptRows: 0, projectUpdates: 0, boqMatches: 0,
    docsDownloaded: 0, docsUploaded: 0, docsLinked: 0, docsSkipped: 0,
    unmatchedPOs: new Set(), errors: [],
  };

  console.log('='.repeat(60));
  console.log('SmartSheet Comprehensive Procurement Sync');
  if (DRY_RUN) console.log('*** DRY RUN — no writes ***');
  console.log('='.repeat(60));

  if (!DOCS_ONLY) {
    await syncItemReceiptData(stats);
  }

  if (!DATA_ONLY) {
    await syncDocuments(stats);
  }

  await reportChecklistGaps();

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log('\n' + '='.repeat(60));
  console.log('SYNC COMPLETE');
  console.log('='.repeat(60));
  console.log(`Duration:            ${duration}s`);
  console.log(`Item receipt rows:   ${stats.itemReceiptRows}`);
  console.log(`Project updates:     ${stats.projectUpdates}`);
  console.log(`BOQ matches:         ${stats.boqMatches}`);
  console.log(`Docs downloaded:     ${stats.docsDownloaded}`);
  console.log(`Docs uploaded:       ${stats.docsUploaded}`);
  console.log(`Docs linked:         ${stats.docsLinked}`);
  console.log(`Docs skipped:        ${stats.docsSkipped}`);
  console.log(`Unmatched POs:       ${stats.unmatchedPOs.size}`);
  console.log(`Errors:              ${stats.errors.length}`);

  if (stats.unmatchedPOs.size > 0) {
    const list = [...stats.unmatchedPOs].sort();
    console.log(`\nUnmatched POs (${list.length}):`);
    list.slice(0, 20).forEach(po => console.log(`  - ${po}`));
    if (list.length > 20) console.log(`  ... and ${list.length - 20} more`);
  }

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${Math.min(stats.errors.length, 10)}):`);
    stats.errors.slice(0, 10).forEach(e => console.log(`  - [${e.po}] ${e.attachment}: ${e.error}`));
  }

  return { errors: stats.errors.length };
}

main()
  .then(r => process.exit(r.errors > 0 ? 1 : 0))
  .catch(err => { console.error('\nFatal:', err); process.exit(1); });
