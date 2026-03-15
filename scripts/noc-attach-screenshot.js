#!/usr/bin/env node
/**
 * Upload a screenshot/file to a NOC ticket as an attachment.
 *
 * Usage:
 *   node scripts/noc-attach-screenshot.js <ticket-id> <file-path> [--evidence]
 *
 * Examples:
 *   node scripts/noc-attach-screenshot.js aa35adec-1bb2-40bf-b9f2-8805a3891b0e /tmp/screenshot.png
 *   node scripts/noc-attach-screenshot.js aa35adec-1bb2-40bf-b9f2-8805a3891b0e /tmp/fix-proof.png --evidence
 *
 * The file is uploaded to VF Storage and a record is created in maintenance_attachments.
 * If --evidence is passed, the attachment is marked as verification evidence.
 */

const fs = require('fs');
const path = require('path');

// Load env
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') }); } catch {}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/noc-attach-screenshot.js <ticket-id> <file-path> [--evidence]');
  process.exit(1);
}

const ticketId = args[0];
const filePath = args[1];
const isEvidence = args.includes('--evidence');

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(ticketId)) {
  console.error(`Invalid ticket ID (must be UUID): ${ticketId}`);
  process.exit(1);
}

async function upload() {
  const { neon } = require('@neondatabase/serverless');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  // Read file
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();

  // Determine mime type
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  // Determine file type
  let fileType = 'document';
  if (mimeType.startsWith('image/')) fileType = 'photo';
  else if (mimeType.startsWith('video/')) fileType = 'video';
  else if (mimeType === 'application/pdf') fileType = 'pdf';

  // Upload to VF Storage
  const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';
  const timestamp = Date.now();
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageName = `${ticketId}_${timestamp}_${sanitized}`;

  console.log(`Uploading ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB) to ticket ${ticketId}...`);

  const FormData = globalThis.FormData || (await import('undici')).FormData;
  const Blob = globalThis.Blob || (await import('buffer')).Blob;

  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: mimeType }), storageName);

  // VF Storage URL pattern: /upload/:type/:category
  const storageRes = await fetch(`${VF_STORAGE_URL}/upload/maintenance/ticket-attachments`, {
    method: 'POST',
    body: form,
  });

  if (!storageRes.ok) {
    const text = await storageRes.text();
    console.error(`VF Storage upload failed (${storageRes.status}): ${text}`);
    process.exit(1);
  }

  const storageResult = await storageRes.json();
  const rawUrl = storageResult.url || `maintenance/ticket-attachments/${storageName}`;
  // Ensure URL has /storage/ prefix for nginx proxy (browser access)
  const storagePath = storageResult.path || `maintenance/ticket-attachments/${storageName}`;
  const storageUrl = rawUrl.startsWith('/storage/') ? rawUrl : `/storage/${storagePath}`;

  console.log(`  Storage URL: ${storageUrl}`);

  // Get Hein's user ID (default uploader for agent-created attachments)
  const sql = neon(process.env.DATABASE_URL);
  const users = await sql`SELECT id FROM users WHERE email = 'hein@velocityfibre.co.za' LIMIT 1`;
  const uploadedBy = users.length > 0 ? users[0].id : null;

  // Create DB record
  const result = await sql`
    INSERT INTO maintenance_attachments (
      ticket_id, filename, file_type, mime_type, file_size,
      storage_path, storage_url, uploaded_by, is_evidence
    ) VALUES (
      ${ticketId}, ${sanitized}, ${fileType}, ${mimeType}, ${fileBuffer.length},
      ${storagePath}, ${storageUrl}, ${uploadedBy}, ${isEvidence}
    )
    RETURNING id, filename, storage_url, is_evidence
  `;

  if (result.length > 0) {
    console.log(`  Attachment ID: ${result[0].id}`);
    console.log(`  Evidence: ${result[0].is_evidence}`);
    console.log('  Done.');
  } else {
    console.error('  Failed to create DB record');
    process.exit(1);
  }
}

upload().catch(err => {
  console.error('Upload failed:', err.message);
  process.exit(1);
});
