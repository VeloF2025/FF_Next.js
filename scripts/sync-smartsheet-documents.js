#!/usr/bin/env node
/**
 * Sync documents from Smartsheet to VF Storage
 * Usage: node scripts/sync-smartsheet-documents.js [limit]
 */

const { neon } = require('@neondatabase/serverless');

// Configuration
const DATABASE_URL = 'process.env.DATABASE_URL';
const SMARTSHEET_API_TOKEN = process.env.SMARTSHEET_API_TOKEN || 'X6McWWfPeBK7G3t7c5qIwQUfJu2gGbtatV2sz';
const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0';
const VF_STORAGE_URL = 'http://100.96.203.105:8091';
const SHEET_ID = '8735086443712388';

const sql = neon(DATABASE_URL);

// Stakeholder name patterns for parsing filenames
const STAKEHOLDER_PATTERNS = {
  'wayleave_eskom': ['eskom', 'escom'],
  'wayleave_telkom': ['telkom'],
  'wayleave_transnet': ['transnet'],
  'wayleave_cell_c': ['cell c', 'cellc'],
  'wayleave_dfa': ['dfa', 'dark fibre'],
  'wayleave_frogfoot': ['frogfoot'],
  'wayleave_liquid': ['liquid'],
  'wayleave_metro_fibre': ['metro fibre', 'metrofibre'],
  'wayleave_mtn': ['mtn'],
  'wayleave_open_serve': ['open serve', 'openserve'],
  'wayleave_vodacom': ['vodacom'],
  'wayleave_vumatel': ['vumatel'],
  'wayleave_rand_water': ['rand water', 'randwater'],
  'wayleave_sasol': ['sasol'],
  'wayleave_city_power': ['city power', 'citypower'],
  'wayleave_city_parks': ['city parks', 'cityparks'],
  'municipal_jra': ['jra', 'johannesburg roads'],
  'municipal_ekurhuleni_roads': ['ekurhuleni roads'],
  'municipal_ekurhuleni_electricity': ['ekurhuleni electricity'],
  'municipal_ekurhuleni_water': ['ekurhuleni water'],
};

// Document type patterns
const DOC_TYPE_PATTERNS = {
  'approval_certificate': ['approval letter', 'approval', 'approved', 'certificate'],
  'application_form': ['application', 'form'],
  'site_plan': ['map', 'plan', 'locality', 'route'],
  'conditions_doc': ['condition', 'conditional'],
  'fee_receipt': ['receipt', 'invoice', 'payment', 'proof of payment'],
  'correspondence': ['email', 'letter', 'response'],
  'supporting_doc': ['indemnity', 'consent', 'signed', 'cession'],
};

function parseStakeholderFromFilename(filename) {
  const lower = filename.toLowerCase();
  for (const [code, patterns] of Object.entries(STAKEHOLDER_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return code;
      }
    }
  }
  return null;
}

function parseDocTypeFromFilename(filename) {
  const lower = filename.toLowerCase();
  for (const [type, patterns] of Object.entries(DOC_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return type;
      }
    }
  }
  return 'other';
}

async function fetchAllAttachments() {
  const allAttachments = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const response = await fetch(
      `${SMARTSHEET_API_BASE}/sheets/${SHEET_ID}/attachments?page=${page}&pageSize=${pageSize}`,
      { headers: { 'Authorization': `Bearer ${SMARTSHEET_API_TOKEN}` } }
    );

    if (!response.ok) {
      throw new Error(`Smartsheet API error: ${response.status}`);
    }

    const data = await response.json();
    allAttachments.push(...data.data);
    console.log(`  Fetched page ${page}: ${data.data.length} attachments`);

    if (data.data.length < pageSize) break;
    page++;
  }

  return allAttachments;
}

async function getAttachmentDownloadUrl(attachmentId) {
  const response = await fetch(
    `${SMARTSHEET_API_BASE}/sheets/${SHEET_ID}/attachments/${attachmentId}`,
    { headers: { 'Authorization': `Bearer ${SMARTSHEET_API_TOKEN}` } }
  );

  if (!response.ok) {
    throw new Error(`Failed to get attachment URL: ${response.status}`);
  }

  const data = await response.json();
  return data.url;
}

async function uploadToStorage(projectId, filename, fileBuffer, mimeType) {
  const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);

  const response = await fetch(
    `${VF_STORAGE_URL}/upload/pipeline/${projectId}`,
    {
      method: 'POST',
      body: body,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString(),
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Storage upload failed: ${error}`);
  }

  const result = await response.json();

  // Convert internal IP URL to public HTTPS URL
  if (result.url && result.url.includes('100.96.203.105:8091')) {
    result.url = result.url.replace('http://100.96.203.105:8091', 'https://vf.fibreflow.app');
  }

  return result;
}

async function syncDocuments(limit) {
  const startTime = Date.now();
  let downloaded = 0;
  let uploaded = 0;
  let linked = 0;
  let skipped = 0;
  const errors = [];

  console.log('='.repeat(60));
  console.log('Smartsheet Document Sync');
  console.log('='.repeat(60));

  // 1. Fetch all attachments
  console.log('\n1. Fetching attachments from Smartsheet...');
  const attachments = await fetchAllAttachments();
  console.log(`   Total: ${attachments.length} attachments\n`);

  // Apply limit if specified
  const toProcess = limit ? attachments.slice(0, limit) : attachments;
  console.log(`   Processing: ${toProcess.length} attachments${limit ? ` (limited)` : ''}\n`);

  // 2. Get project mapping
  console.log('2. Loading project mappings...');
  const projects = await sql`
    SELECT id, smartsheet_id FROM pipeline_projects WHERE smartsheet_id IS NOT NULL
  `;
  const projectMap = new Map(projects.map(p => [p.smartsheet_id, p.id]));
  console.log(`   Loaded ${projects.length} projects\n`);

  // 3. Get approval types
  const approvalTypes = await sql`
    SELECT id, code FROM pipeline_approval_types WHERE is_active = true
  `;
  const approvalTypeMap = new Map(approvalTypes.map(t => [t.code, t.id]));
  console.log(`   Loaded ${approvalTypes.length} approval types\n`);

  // 4. Get existing documents to skip
  console.log('3. Checking for existing documents...');
  const existingDocs = new Set(
    (await sql`
      SELECT smartsheet_attachment_id FROM pipeline_approval_documents
      WHERE smartsheet_attachment_id IS NOT NULL
    `).map(d => d.smartsheet_attachment_id)
  );
  console.log(`   Found ${existingDocs.size} already synced\n`);

  // 5. Process each attachment
  console.log('4. Processing attachments...\n');
  let processed = 0;

  for (const attachment of toProcess) {
    processed++;
    const attachmentIdStr = String(attachment.id);
    const progress = Math.round((processed / toProcess.length) * 100);

    // Skip if already synced
    if (existingDocs.has(attachmentIdStr)) {
      skipped++;
      continue;
    }

    // Skip non-row attachments
    if (attachment.parentType !== 'ROW') {
      skipped++;
      continue;
    }

    const rowId = String(attachment.parentId);
    const projectId = projectMap.get(rowId);

    if (!projectId) {
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`\r   [${progress}%] ${downloaded}/${processed} - ${attachment.name.substring(0, 40)}...`);

      // Get download URL
      const downloadUrl = await getAttachmentDownloadUrl(attachment.id);

      // Download file
      const fileResponse = await fetch(downloadUrl);
      if (!fileResponse.ok) {
        throw new Error(`Download failed: ${fileResponse.status}`);
      }

      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
      downloaded++;

      // Upload to storage
      const { url, path } = await uploadToStorage(
        projectId,
        attachment.name,
        fileBuffer,
        attachment.mimeType
      );
      uploaded++;

      // Parse stakeholder and doc type
      const stakeholderCode = parseStakeholderFromFilename(attachment.name);
      const docType = parseDocTypeFromFilename(attachment.name);

      // Find or create approval for this stakeholder
      let approvalId = null;

      if (stakeholderCode) {
        const approvalTypeId = approvalTypeMap.get(stakeholderCode);

        if (approvalTypeId) {
          const existingApproval = await sql`
            SELECT id FROM pipeline_project_approvals
            WHERE pipeline_project_id = ${projectId}
            AND approval_type_id = ${approvalTypeId}
          `;

          if (existingApproval.length > 0) {
            approvalId = existingApproval[0].id;
          } else {
            const newApproval = await sql`
              INSERT INTO pipeline_project_approvals (
                pipeline_project_id, approval_type_id, status
              ) VALUES (
                ${projectId}, ${approvalTypeId}, 'approved'
              )
              RETURNING id
            `;
            approvalId = newApproval[0].id;
          }
        }
      }

      // Create document record
      const documentName = attachment.name.replace(/\.[^/.]+$/, '');

      await sql`
        INSERT INTO pipeline_approval_documents (
          pipeline_project_id,
          approval_id,
          document_type,
          document_name,
          file_name,
          file_url,
          file_path,
          file_size,
          mime_type,
          smartsheet_attachment_id,
          created_at
        ) VALUES (
          ${projectId},
          ${approvalId},
          ${docType},
          ${documentName},
          ${attachment.name},
          ${url},
          ${path},
          ${attachment.sizeInKb * 1024},
          ${attachment.mimeType},
          ${attachmentIdStr},
          NOW()
        )
      `;
      linked++;

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      errors.push({
        attachmentId: attachment.id,
        name: attachment.name,
        error: error.message,
      });
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log('\n\n' + '='.repeat(60));
  console.log('SYNC COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total Attachments: ${attachments.length}`);
  console.log(`Processed:         ${toProcess.length}`);
  console.log(`Downloaded:        ${downloaded}`);
  console.log(`Uploaded:          ${uploaded}`);
  console.log(`Linked in DB:      ${linked}`);
  console.log(`Skipped:           ${skipped}`);
  console.log(`Errors:            ${errors.length}`);
  console.log(`Duration:          ${duration}s`);
  console.log('='.repeat(60));

  if (errors.length > 0 && errors.length <= 10) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
  } else if (errors.length > 10) {
    console.log(`\nFirst 10 errors (of ${errors.length}):`);
    errors.slice(0, 10).forEach(e => console.log(`  - ${e.name}: ${e.error}`));
  }

  return { downloaded, uploaded, linked, skipped, errors: errors.length };
}

// Main
const limit = process.argv[2] ? parseInt(process.argv[2]) : null;
console.log(limit ? `Running with limit: ${limit}` : 'Running full sync...');

syncDocuments(limit)
  .then(result => {
    console.log('\nDone!');
    process.exit(result.errors > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('\nFatal error:', err);
    process.exit(1);
  });
