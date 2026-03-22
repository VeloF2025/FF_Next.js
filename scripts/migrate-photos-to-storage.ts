#!/usr/bin/env npx ts-node
/**
 * Migrate all construction_qa_photos to local storage on Velo.
 *
 * Sources:
 *   - sharepoint: Download via MS Graph API → /home/velo/storage/qa-photos/{project}/{feature}/{filename}
 *   - qfield:     Copy from MinIO via mc cat  → same structure
 *   - upload:     Already local, just copy     → same structure
 *
 * After download, updates DB: source → 'local', storage_key → relative path under storage root.
 *
 * Usage:
 *   npx ts-node scripts/migrate-photos-to-storage.ts [--source sharepoint|qfield|upload] [--project "Name"] [--dry-run]
 */

import { neon } from '@neondatabase/serverless';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL!;
const sql = neon(DATABASE_URL);

const STORAGE_ROOT = '/home/velo/storage/qa-photos';
const MINIO_BUCKET = 'qfieldcloud-prod';
const LOCAL_UPLOADS = path.join(process.cwd(), 'public', 'uploads', 'qa-photos');

// SharePoint Graph API config
const SP_TENANT_ID = 'f22e6344-a35d-43b0-ad8c-a247f513c1ee';
const SP_CLIENT_ID = '075bd672-bffa-45ba-9fd0-724535e612db';
const SP_CLIENT_SECRET = 'Ozw8Q~HG1PMZFPNb0Ze1f-eTYrtglVioRzy2lakF';

let spToken: string | null = null;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceFilter = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
const projectFilter = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;

// ---------------------------------------------------------------------------
// SharePoint token
// ---------------------------------------------------------------------------
async function getSpToken(): Promise<string> {
  if (spToken) return spToken;

  const tokenUrl = `https://login.microsoftonline.com/${SP_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: SP_CLIENT_ID,
    client_secret: SP_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`SP token failed: ${res.status}`);
  const data = await res.json();
  spToken = data.access_token;
  return spToken!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sanitizePath(name: string): string {
  return name.replace(/[<>:"|?*]/g, '_').replace(/\s+/g, '_');
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Download: SharePoint
// ---------------------------------------------------------------------------
async function downloadSharePoint(
  photoId: string,
  storageKey: string,
  storageUrl: string,
  destPath: string
): Promise<boolean> {
  try {
    const token = await getSpToken();

    // storageUrl is like https://graph.microsoft.com/v1.0/drives/{driveId}/items/{itemId}/content
    // or storageKey is sharepoint:{driveId}:{itemId}
    let downloadUrl = storageUrl;
    if (!downloadUrl.endsWith('/content')) {
      downloadUrl += '/content';
    }

    const res = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });

    if (!res.ok) {
      console.error(`  [FAIL] SP ${res.status} for ${photoId}: ${storageKey}`);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) {
      console.error(`  [FAIL] SP tiny response (${buffer.length}b) for ${photoId}`);
      return false;
    }

    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    console.error(`  [FAIL] SP error for ${photoId}: ${(err as Error).message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Download: QField (MinIO)
// ---------------------------------------------------------------------------
function downloadQField(storageKey: string, destPath: string): boolean {
  try {
    const objectPath = storageKey.startsWith('/') ? storageKey.slice(1) : storageKey;
    const mcPath = `local/${MINIO_BUCKET}/${objectPath}`;
    const escapedPath = mcPath.replace(/'/g, "'\\''");
    const command = `docker exec qfieldcloud-minio-1 mc cat '${escapedPath}'`;

    const buffer = execSync(command, { maxBuffer: 50 * 1024 * 1024 });
    if (buffer.length < 100) {
      console.error(`  [FAIL] MinIO tiny response (${buffer.length}b): ${storageKey}`);
      return false;
    }

    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    console.error(`  [FAIL] MinIO error: ${(err as Error).message.slice(0, 100)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Copy: Upload (local filesystem)
// ---------------------------------------------------------------------------
function copyUpload(storageKey: string, destPath: string): boolean {
  try {
    // storageKey is like qa-photos/thembisa-pop-1/TEM.P.A001/filename.jpeg
    // strip the qa-photos/ prefix to get the subpath
    const subPath = storageKey.replace(/^qa-photos\//, '');
    const srcPath = path.join(LOCAL_UPLOADS, subPath);

    if (!fs.existsSync(srcPath)) {
      console.error(`  [FAIL] Local file not found: ${srcPath}`);
      return false;
    }

    fs.copyFileSync(srcPath, destPath);
    return true;
  } catch (err) {
    console.error(`  [FAIL] Copy error: ${(err as Error).message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Photo Migration to Local Storage ===');
  console.log(`Storage root: ${STORAGE_ROOT}`);
  console.log(`Dry run: ${dryRun}`);
  if (sourceFilter) console.log(`Source filter: ${sourceFilter}`);
  if (projectFilter) console.log(`Project filter: ${projectFilter}`);

  // Build query
  let whereClause = `WHERE 1=1`;
  if (sourceFilter) whereClause += ` AND p.source = '${sourceFilter}'`;

  const rows = await sql(`
    SELECT
      p.id,
      p.source,
      p.storage_key,
      p.storage_url,
      p.filename,
      pr.project_name,
      r.feature_id
    FROM construction_qa_photos p
    JOIN construction_qa_reviews r ON p.review_id = r.id
    JOIN projects pr ON r.project_id = pr.id
    ${whereClause}
    ${projectFilter ? `AND pr.project_name = '${projectFilter}'` : ''}
    ORDER BY pr.project_name, r.feature_id, p.created_at
  `);

  console.log(`\nTotal photos to migrate: ${rows.length}`);

  const stats = { success: 0, failed: 0, skipped: 0 };
  const batchSize = 50;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const projectSlug = sanitizePath(String(row.project_name).toLowerCase().replace(/\s+/g, '-'));
    const featureId = sanitizePath(String(row.feature_id));
    const filename = row.filename || `${row.id}.jpg`;
    const safeFilename = sanitizePath(filename);

    const relPath = `${projectSlug}/${featureId}/${safeFilename}`;
    const destPath = path.join(STORAGE_ROOT, relPath);

    // Skip if already exists
    if (fs.existsSync(destPath)) {
      stats.skipped++;
      continue;
    }

    if (dryRun) {
      if (i < 5) console.log(`  [DRY] ${row.source} → ${relPath}`);
      stats.success++;
      continue;
    }

    ensureDir(path.dirname(destPath));

    let ok = false;
    if (row.source === 'sharepoint') {
      ok = await downloadSharePoint(row.id, row.storage_key, row.storage_url || '', destPath);
      // Rate limit: 1 request per 50ms to avoid Graph API throttling
      if (ok) await new Promise((r) => setTimeout(r, 50));
    } else if (row.source === 'qfield') {
      ok = downloadQField(row.storage_key, destPath);
    } else if (row.source === 'upload') {
      ok = copyUpload(row.storage_key, destPath);
    } else {
      console.error(`  [SKIP] Unknown source: ${row.source}`);
      stats.skipped++;
      continue;
    }

    if (ok) {
      // Update DB: set source to 'local' and storage_key to relative path
      await sql`
        UPDATE construction_qa_photos
        SET source = 'local',
            storage_key = ${relPath},
            updated_at = NOW()
        WHERE id = ${row.id}::uuid
      `;
      stats.success++;
    } else {
      stats.failed++;
    }

    // Progress
    if ((i + 1) % batchSize === 0 || i === rows.length - 1) {
      const pct = (((i + 1) / rows.length) * 100).toFixed(1);
      console.log(`  [${pct}%] ${i + 1}/${rows.length} | OK: ${stats.success} | Failed: ${stats.failed} | Skipped: ${stats.skipped}`);
    }
  }

  console.log('\n=== Migration Complete ===');
  console.log(`Success: ${stats.success}`);
  console.log(`Failed:  ${stats.failed}`);
  console.log(`Skipped: ${stats.skipped}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
