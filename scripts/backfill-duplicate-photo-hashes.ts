/**
 * Backfill Script: Seed photo_content_hashes from historical step -1 decisions
 *
 * Finds all DRs where photos_metadata contains photos with step = -1
 * (human-marked duplicates), fetches each photo, computes its SHA-256 hash,
 * and inserts into photo_content_hashes with marked_duplicate_by = 'backfill'.
 *
 * Usage:
 *   DATABASE_URL='...' npx tsx scripts/backfill-duplicate-photo-hashes.ts
 *   DATABASE_URL='...' npx tsx scripts/backfill-duplicate-photo-hashes.ts --dry-run
 */

import { createHash } from 'crypto';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const VPS_PHOTO_API = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';
const VELOCITY_PHOTO_API = process.env.VELOCITY_PHOTO_URL || 'http://100.96.203.105:8003';

function resolvePhotoUrl(dropNumber: string, filename: string): string {
  const isWa = filename.toLowerCase().startsWith('wa_');
  if (isWa) {
    return `${VPS_PHOTO_API}/photos/${dropNumber}/${filename}`;
  }
  return `${VELOCITY_PHOTO_API}/api/photo/${dropNumber}/${filename}`;
}

async function fetchAndHash(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return createHash('sha256').update(buffer).digest('hex');
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Backfill duplicate photo hashes${dryRun ? ' (DRY RUN)' : ''}`);
  console.log('---');

  // Find all DRs with step -1 photos
  const result = await pool.query(`
    SELECT drop_number, photos_metadata
    FROM dr_photo_unified_reviews
    WHERE photos_metadata IS NOT NULL
      AND photos_metadata::text LIKE '%"step":-1%'
  `);

  console.log(`Found ${result.rows.length} DRs with step -1 photos`);

  let totalHashed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const row of result.rows) {
    const dropNumber = row.drop_number;
    const photos: Array<{ filename: string; step: number }> = row.photos_metadata || [];
    const duplicatePhotos = photos.filter((p) => p.step === -1);

    if (duplicatePhotos.length === 0) continue;

    console.log(`\n${dropNumber}: ${duplicatePhotos.length} duplicate photo(s)`);

    for (const photo of duplicatePhotos) {
      const url = resolvePhotoUrl(dropNumber, photo.filename);
      const hash = await fetchAndHash(url);

      if (!hash) {
        console.log(`  SKIP ${photo.filename} (fetch failed)`);
        totalFailed++;
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY] ${photo.filename} → ${hash.slice(0, 16)}...`);
        totalHashed++;
        continue;
      }

      try {
        await pool.query(
          `INSERT INTO photo_content_hashes (drop_number, filename, sha256_hash, marked_duplicate_by, marked_duplicate_at)
           VALUES ($1, $2, $3, 'backfill', NOW())
           ON CONFLICT (drop_number, filename)
           DO UPDATE SET sha256_hash = EXCLUDED.sha256_hash, marked_duplicate_by = 'backfill', marked_duplicate_at = NOW()`,
          [dropNumber, photo.filename, hash]
        );
        console.log(`  OK   ${photo.filename} → ${hash.slice(0, 16)}...`);
        totalHashed++;
      } catch (err) {
        console.log(`  ERR  ${photo.filename}: ${err instanceof Error ? err.message : err}`);
        totalFailed++;
      }
    }
  }

  console.log('\n---');
  console.log(`Done. Hashed: ${totalHashed}, Failed: ${totalFailed}, Skipped: ${totalSkipped}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
