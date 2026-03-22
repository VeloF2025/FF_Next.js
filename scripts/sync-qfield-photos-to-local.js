#!/usr/bin/env node
/**
 * Bulk copy QField photos from MinIO to local storage.
 * Updates source='qfield' → source='local' after successful copy.
 *
 * Usage: node scripts/sync-qfield-photos-to-local.js [--limit 1000]
 */
const { neon } = require('@neondatabase/serverless');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';
const sql = neon(DB_URL);
const STORAGE_ROOT = process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 6000;

function sanitize(name) {
  return name.replace(/[<>:"|?*]/g, '_');
}

async function main() {
  const rows = await sql`
    SELECT p.id, p.storage_key, p.filename, r.feature_id, pr.project_name
    FROM construction_qa_photos p
    JOIN construction_qa_reviews r ON p.review_id = r.id
    JOIN projects pr ON r.project_id = pr.id
    WHERE p.source = 'qfield'
    ORDER BY p.created_at DESC
    LIMIT ${LIMIT}
  `;

  if (rows.length === 0) {
    console.log('No QField photos to sync');
    return;
  }

  console.log(`Syncing ${rows.length} QField photos to local storage...`);
  const stats = { ok: 0, skip: 0, fail: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const projectSlug = String(row.project_name).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const featureId = sanitize(String(row.feature_id));
    // Use original DCIM filename from storage_key if possible
    const dcimMatch = row.storage_key.match(/DCIM\/([^/]+)\//);
    const filename = dcimMatch ? sanitize(dcimMatch[1]) : sanitize(row.filename || `${row.id}.jpg`);
    const relPath = `${projectSlug}/${featureId}/${filename}`;
    const destPath = path.join(STORAGE_ROOT, relPath);

    if (fs.existsSync(destPath)) {
      // File already on disk, just update DB
      await sql`
        UPDATE construction_qa_photos
        SET source = 'local', storage_key = ${relPath}, updated_at = NOW()
        WHERE id = ${row.id}::uuid AND source = 'qfield'
      `;
      stats.skip++;
      continue;
    }

    try {
      const objectPath = row.storage_key.startsWith('/') ? row.storage_key.slice(1) : row.storage_key;
      const mcPath = `local/${MINIO_BUCKET}/${objectPath}`;
      const escapedPath = mcPath.replace(/'/g, "'\\''" );

      const buffer = execSync(`docker exec qfieldcloud-minio-1 mc cat '${escapedPath}'`, {
        maxBuffer: 50 * 1024 * 1024,
      });

      if (buffer.length < 100) {
        stats.fail++;
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buffer);

      await sql`
        UPDATE construction_qa_photos
        SET source = 'local', storage_key = ${relPath}, updated_at = NOW()
        WHERE id = ${row.id}::uuid
      `;
      stats.ok++;
    } catch (err) {
      stats.fail++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${rows.length} | OK: ${stats.ok} | Skip: ${stats.skip} | Fail: ${stats.fail}`);
    }
  }

  console.log(`Done: OK=${stats.ok} Skip=${stats.skip} Fail=${stats.fail}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
