/**
 * Copy QField photos from MinIO to local storage and update DB source to 'local'.
 * Usage: node scripts/migrate-qfield-photos.js
 */
const { neon } = require('@neondatabase/serverless');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const sql = neon('postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require');
const STORAGE_ROOT = '/home/velo/storage/qa-photos';
const MINIO_BUCKET = 'qfieldcloud-prod';

function sanitize(name) {
  return name.replace(/[<>:"|?*]/g, '_');
}

async function main() {
  console.log('=== QField MinIO → Local Storage Migration ===');

  const rows = await sql`
    SELECT p.id, p.storage_key, p.filename, pr.project_name, r.feature_id
    FROM construction_qa_photos p
    JOIN construction_qa_reviews r ON p.review_id = r.id
    JOIN projects pr ON r.project_id = pr.id
    WHERE p.source = 'qfield'
    ORDER BY pr.project_name, r.feature_id, p.created_at
  `;

  console.log(`Total QField photos: ${rows.length}\n`);
  const stats = { ok: 0, fail: 0, skipped: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const projectSlug = String(row.project_name).toLowerCase().replace(/\s+/g, '-');
    const featureId = sanitize(String(row.feature_id));
    const filename = sanitize(row.filename || `${row.id}.jpg`);
    const relPath = `${projectSlug}/${featureId}/${filename}`;
    const destPath = path.join(STORAGE_ROOT, relPath);

    if (fs.existsSync(destPath)) {
      stats.skipped++;
      continue;
    }

    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });

    try {
      const objectPath = row.storage_key.startsWith('/') ? row.storage_key.slice(1) : row.storage_key;
      const mcPath = `local/${MINIO_BUCKET}/${objectPath}`;
      const escapedPath = mcPath.replace(/'/g, "'\\''");
      const buf = execSync(`docker exec qfieldcloud-minio-1 mc cat '${escapedPath}'`, {
        maxBuffer: 50 * 1024 * 1024,
      });

      if (buf.length < 100) {
        console.error(`  [FAIL] tiny ${buf.length}b: ${row.id}`);
        stats.fail++;
        continue;
      }

      fs.writeFileSync(destPath, buf);

      await sql`
        UPDATE construction_qa_photos
        SET source = 'local',
            storage_key = ${relPath},
            updated_at = NOW()
        WHERE id = ${row.id}::uuid
      `;

      stats.ok++;
    } catch (err) {
      console.error(`  [FAIL] ${row.id}: ${err.message.slice(0, 80)}`);
      stats.fail++;
    }

    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      const pct = (((i + 1) / rows.length) * 100).toFixed(1);
      console.log(`[${pct}%] ${i + 1}/${rows.length} | OK: ${stats.ok} | Skip: ${stats.skipped} | Fail: ${stats.fail}`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`OK: ${stats.ok} | Skipped: ${stats.skipped} | Failed: ${stats.fail}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
