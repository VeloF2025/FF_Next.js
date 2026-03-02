#!/usr/bin/env node
/**
 * Sync PO documents from Smartsheet to VF Storage + procurement_documents table
 *
 * Sources:
 *   1. Item Receipts       (8404664677519236)  — invoices & delivery notes
 *   2. Delivery Note Reg.  (84737013010308)    — delivery notes
 *   3. Quote Approval Reg. (1589086541270916)  — supplier quotes
 *
 * Usage:
 *   node scripts/sync-smartsheet-po-documents.js [limit]
 *
 * Idempotent — uses notes='smartsheet:{attachmentId}' for dedup.
 */

const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
const SMARTSHEET_API_TOKEN = process.env.SMARTSHEET_API_TOKEN || 'X6McWWfPeBK7G3t7c5qIwQUfJu2gGbtatV2sz';
const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0';
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

const sql = neon(DATABASE_URL);

// Sheet definitions
const SHEETS = [
  {
    name: 'Item Receipts',
    id: '8404664677519236',
    poColumn: 'PO Number',
    docNameColumn: 'Invoice/Delivery Note Number',
    contextColumn: 'Supplier',
    defaultDocType: null, // inferred from filename
  },
  {
    name: 'Delivery Note Register',
    id: '84737013010308',
    poColumn: 'PROC - RECON VF PO#',
    docNameColumn: 'Delivery Note Number',
    contextColumn: null,
    defaultDocType: 'delivery_note',
  },
  {
    name: 'Quote Approval Register',
    id: '1589086541270916',
    poColumn: 'PO Number',
    docNameColumn: 'Quote Number',
    contextColumn: null,
    defaultDocType: 'quote_pdf',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Infer document_type from filename when sheet doesn't have a fixed type */
function inferDocType(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('invoice') || lower.includes('inv')) return 'invoice';
  if (lower.includes('delivery') || lower.includes('dn') || lower.includes('pod')) return 'delivery_note';
  if (lower.includes('quote') || lower.includes('rfq')) return 'quote_pdf';
  if (lower.includes('receipt') || lower.includes('grv')) return 'receipt';
  return 'delivery_note'; // default for Item Receipts sheet
}

/** Guess MIME type from filename extension */
function guessMimeType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

/** Rate-limited delay */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Smartsheet API
// ---------------------------------------------------------------------------

async function ssGet(path) {
  const res = await fetch(`${SMARTSHEET_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${SMARTSHEET_API_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SS API ${res.status} for ${path}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

/** Fetch full sheet (columns + rows) */
async function fetchSheet(sheetId) {
  return ssGet(`/sheets/${sheetId}`);
}

/** Fetch all attachments for a sheet, paginated */
async function fetchAllAttachments(sheetId) {
  const all = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const data = await ssGet(`/sheets/${sheetId}/attachments?page=${page}&pageSize=${pageSize}`);
    all.push(...data.data);
    if (data.data.length < pageSize) break;
    page++;
    await delay(50);
  }

  return all;
}

/** Get temporary download URL for an attachment */
async function getAttachmentUrl(sheetId, attachmentId) {
  const data = await ssGet(`/sheets/${sheetId}/attachments/${attachmentId}`);
  return data.url;
}

// ---------------------------------------------------------------------------
// VF Storage upload
// ---------------------------------------------------------------------------

async function uploadToStorage(poId, filename, fileBuffer, mimeType) {
  const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
  const storageName = `${poId}_${filename}`;

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${storageName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
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

  // Build public HTTPS URL
  const storagePath = result.path || `procurement/purchase_order/${result.filename || storageName}`;
  const publicUrl = `https://vf.fibreflow.app/storage/${storagePath}`;

  return {
    url: publicUrl,
    path: storagePath,
    size: result.size || fileBuffer.length,
  };
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

async function syncPODocuments(limit) {
  const startTime = Date.now();
  const stats = { downloaded: 0, uploaded: 0, linked: 0, skipped: 0, unmatchedPOs: new Set(), errors: [] };

  console.log('='.repeat(60));
  console.log('Smartsheet PO Document Sync');
  console.log('='.repeat(60));

  // 1. Load PO lookup from DB
  console.log('\n1. Loading purchase orders...');
  const pos = await sql`
    SELECT id, external_po_number
    FROM purchase_orders
    WHERE external_po_number IS NOT NULL
  `;
  const poMap = new Map();
  for (const po of pos) {
    // Normalize: trim, uppercase for matching
    const key = po.external_po_number.trim().toUpperCase();
    poMap.set(key, po.id);
  }
  console.log(`   Loaded ${pos.length} POs with external_po_number`);

  // 2. Load already-synced attachment IDs for idempotency
  console.log('\n2. Checking for already-synced documents...');
  const synced = await sql`
    SELECT notes FROM procurement_documents
    WHERE notes LIKE 'smartsheet:%'
      AND is_active = true
  `;
  // Extract just the 'smartsheet:{id}' prefix (notes may contain '| context')
  const syncedIds = new Set(synced.map((r) => r.notes.split(' |')[0].trim()));
  console.log(`   Found ${syncedIds.size} already synced`);

  // 3. Collect all work items from all 3 sheets
  console.log('\n3. Fetching sheet data from Smartsheet...');
  const workItems = [];

  for (const sheet of SHEETS) {
    console.log(`\n   --- ${sheet.name} (${sheet.id}) ---`);

    // Fetch sheet columns + rows
    const sheetData = await fetchSheet(sheet.id);
    const columns = sheetData.columns || [];
    const rows = sheetData.rows || [];

    // Build column map: title → columnId
    const colMap = new Map();
    for (const col of columns) {
      colMap.set(col.title, col.id);
    }

    const poColId = colMap.get(sheet.poColumn);
    const docNameColId = sheet.docNameColumn ? colMap.get(sheet.docNameColumn) : null;
    const ctxColId = sheet.contextColumn ? colMap.get(sheet.contextColumn) : null;

    if (!poColId) {
      console.log(`   WARNING: PO column "${sheet.poColumn}" not found — skipping sheet`);
      continue;
    }

    // Build rowId → row data lookup
    const rowLookup = new Map();
    for (const row of rows) {
      const cells = row.cells || [];
      let poNumber = null;
      let docName = null;
      let context = null;

      for (const cell of cells) {
        if (cell.columnId === poColId && cell.value) poNumber = String(cell.value).trim();
        if (docNameColId && cell.columnId === docNameColId && cell.value) docName = String(cell.value).trim();
        if (ctxColId && cell.columnId === ctxColId && cell.value) context = String(cell.value).trim();
      }

      if (poNumber) {
        rowLookup.set(row.id, { poNumber, docName, context });
      }
    }

    console.log(`   Rows with PO numbers: ${rowLookup.size}`);

    // Fetch all attachments for the sheet
    const attachments = await fetchAllAttachments(sheet.id);
    console.log(`   Attachments: ${attachments.length}`);

    // Filter to ROW attachments and group
    let rowAttachments = 0;
    for (const att of attachments) {
      if (att.parentType !== 'ROW') continue;
      rowAttachments++;

      const rowData = rowLookup.get(att.parentId);
      if (!rowData) continue;

      workItems.push({
        sheetId: sheet.id,
        sheetName: sheet.name,
        attachmentId: att.id,
        attachmentName: att.name,
        mimeType: att.mimeType || guessMimeType(att.name),
        sizeInKb: att.sizeInKb || 0,
        poNumber: rowData.poNumber,
        docName: rowData.docName || att.name.replace(/\.[^/.]+$/, ''),
        context: rowData.context,
        docType: sheet.defaultDocType || inferDocType(att.name),
      });
    }

    console.log(`   Row attachments: ${rowAttachments}`);
  }

  console.log(`\n   Total work items: ${workItems.length}`);

  // Apply limit
  const toProcess = limit ? workItems.slice(0, limit) : workItems;
  if (limit) console.log(`   Processing limit: ${limit}`);

  // 4. Process each attachment
  console.log('\n4. Processing attachments...\n');
  let processed = 0;

  for (const item of toProcess) {
    processed++;
    const dedupKey = `smartsheet:${item.attachmentId}`;
    const progress = Math.round((processed / toProcess.length) * 100);

    // Skip if already synced
    if (syncedIds.has(dedupKey)) {
      stats.skipped++;
      continue;
    }

    // Normalize PO number and look up
    // Handle comma-separated or multi-PO references — take the first one
    const rawPO = item.poNumber.split(/[,;\/]/)[0].trim().toUpperCase();
    // Try exact match, then with PO prefix variants
    let poId = poMap.get(rawPO);
    if (!poId && !rawPO.startsWith('PO')) {
      poId = poMap.get(`PO${rawPO}`) || poMap.get(`PO-${rawPO}`) || poMap.get(`PO ${rawPO}`);
    }

    if (!poId) {
      stats.unmatchedPOs.add(item.poNumber);
      stats.skipped++;
      continue;
    }

    try {
      process.stdout.write(
        `\r   [${progress}%] ${stats.linked}/${processed} - ${item.attachmentName.substring(0, 45).padEnd(45)}  `
      );

      // Get download URL
      const downloadUrl = await getAttachmentUrl(item.sheetId, item.attachmentId);
      await delay(50);

      // Download file
      const fileResp = await fetch(downloadUrl);
      if (!fileResp.ok) throw new Error(`Download HTTP ${fileResp.status}`);
      const fileBuffer = Buffer.from(await fileResp.arrayBuffer());
      stats.downloaded++;

      // Upload to VF Storage
      const { url, path, size } = await uploadToStorage(
        poId,
        item.attachmentName,
        fileBuffer,
        item.mimeType
      );
      stats.uploaded++;

      // Insert procurement_documents row
      const notesValue = item.context
        ? `${dedupKey} | ${item.context}`
        : dedupKey;

      await sql`
        INSERT INTO procurement_documents (
          entity_type, entity_id, document_type, document_name,
          file_url, file_path, file_size, mime_type,
          uploaded_by, uploaded_by_name, notes, is_active
        ) VALUES (
          'purchase_order', ${poId}::uuid, ${item.docType}, ${item.docName},
          ${url}, ${path}, ${size}, ${item.mimeType},
          'system@fibreflow.app', 'Smartsheet Sync',
          ${notesValue}, true
        )
      `;
      stats.linked++;

      // Rate limit
      await delay(100);
    } catch (error) {
      stats.errors.push({
        attachmentId: item.attachmentId,
        name: item.attachmentName,
        po: item.poNumber,
        error: error.message,
      });
    }
  }

  // 5. Summary
  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log('\n\n' + '='.repeat(60));
  console.log('SYNC COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total work items:  ${workItems.length}`);
  console.log(`Processed:         ${toProcess.length}`);
  console.log(`Downloaded:        ${stats.downloaded}`);
  console.log(`Uploaded:          ${stats.uploaded}`);
  console.log(`Linked in DB:      ${stats.linked}`);
  console.log(`Skipped:           ${stats.skipped}`);
  console.log(`Unmatched POs:     ${stats.unmatchedPOs.size}`);
  console.log(`Errors:            ${stats.errors.length}`);
  console.log(`Duration:          ${duration}s`);
  console.log('='.repeat(60));

  if (stats.unmatchedPOs.size > 0) {
    const poList = [...stats.unmatchedPOs].sort();
    console.log(`\nUnmatched PO numbers (${poList.length}):`);
    poList.slice(0, 20).forEach((po) => console.log(`  - ${po}`));
    if (poList.length > 20) console.log(`  ... and ${poList.length - 20} more`);
  }

  if (stats.errors.length > 0 && stats.errors.length <= 10) {
    console.log('\nErrors:');
    stats.errors.forEach((e) => console.log(`  - [${e.po}] ${e.name}: ${e.error}`));
  } else if (stats.errors.length > 10) {
    console.log(`\nFirst 10 errors (of ${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach((e) => console.log(`  - [${e.po}] ${e.name}: ${e.error}`));
  }

  return { linked: stats.linked, errors: stats.errors.length };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
const limit = process.argv[2] ? parseInt(process.argv[2]) : null;
console.log(limit ? `Running with limit: ${limit}` : 'Running full sync...');

syncPODocuments(limit)
  .then((result) => {
    console.log('\nDone!');
    process.exit(result.errors > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('\nFatal error:', err);
    process.exit(1);
  });
