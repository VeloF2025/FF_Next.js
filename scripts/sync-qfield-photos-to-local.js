#!/usr/bin/env node
/**
 * Bulk copy QField photos from MinIO to local storage.
 * Updates source='qfield' → source='local' after successful copy.
 *
 * Usage: DATABASE_URL=... node scripts/sync-qfield-photos-to-local.js [--limit 1000]
 */
const { Pool } = require('pg');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL is required (see .claude/credentials.local.md)');
  process.exit(1);
}
const pool = new Pool({ connectionString: DB_URL });
const STORAGE_ROOT = process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 6000;

function sanitize(name) {
  return name.replace(/[<>:"|?*]/g, '_');
}

async function main() {
  const { rows } = await pool.query(
    `SELECT p.id, p.storage_key, p.filename, r.feature_id, pr.project_name
     FROM construction_qa_photos p
     JOIN construction_qa_reviews r ON p.review_id = r.id
     JOIN projects pr ON r.project_id = pr.id
     WHERE p.source = 'qfield'
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [LIMIT]
  );

  if (rows.length === 0) {
    console.log('No QField photos to sync');
    return;
  }

  console.log(`Syncing ${rows.length} QField photos to local storage...`);
  const stats = { ok: 0, skip: 0, fail: 0 };
  const failures = [];

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
      await pool.query(
        `UPDATE construction_qa_photos
         SET source = 'local', storage_key = $1, updated_at = NOW()
         WHERE id = $2::uuid AND source = 'qfield'`,
        [relPath, row.id]
      );
      stats.skip++;
      continue;
    }

    try {
      const objectPath = row.storage_key.startsWith('/') ? row.storage_key.slice(1) : row.storage_key;
      const mcPath = `local/${MINIO_BUCKET}/${objectPath}`;

      // execFileSync (no shell): storage_key is DB-sourced, so never interpolate it into a shell string.
      const buffer = execFileSync(
        'docker',
        ['exec', 'qfieldcloud-minio-1', 'mc', 'cat', mcPath],
        { maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
      );

      if (buffer.length < 100) {
        stats.fail++;
        failures.push({ key: row.storage_key, reason: `too small (${buffer.length} bytes)` });
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buffer);

      await pool.query(
        `UPDATE construction_qa_photos
         SET source = 'local', storage_key = $1, updated_at = NOW()
         WHERE id = $2::uuid AND source = 'qfield'`,
        [relPath, row.id]
      );
      stats.ok++;
    } catch (err) {
      stats.fail++;
      failures.push({ key: row.storage_key, reason: String(err.message || err).slice(0, 200) });
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${rows.length} | OK: ${stats.ok} | Skip: ${stats.skip} | Fail: ${stats.fail}`);
    }
  }

  console.log(`Done: OK=${stats.ok} Skip=${stats.skip} Fail=${stats.fail}`);

  // Never drop failures silently — they are unsynced field evidence.
  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures.slice(0, 50)) {
      console.error(`  ${f.key} -> ${f.reason}`);
    }
    if (failures.length > 50) console.error(`  ... and ${failures.length - 50} more`);
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('Fatal:', e);
    await pool.end();
    process.exit(1);
  });
