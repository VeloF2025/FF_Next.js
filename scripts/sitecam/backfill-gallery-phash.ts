/**
 * Backfill perceptual hashes (phash) for existing vlm_visual_photo_examples
 * rows so relevance-based few-shot selection (src/lib/vlmGallery.ts) can rank
 * them. One-time; safe to re-run (only touches rows where phash IS NULL).
 *
 * Requires migration 422 (adds the phash column) to have been applied first.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/sitecam/backfill-gallery-phash.ts [--limit N] [--dry]
 *
 * Reads each photo from its backend source, computes the dHash, and UPDATEs the
 * row. Rows whose photo can't be fetched/decoded are left NULL (recency
 * fallback still applies) and reported.
 */
/* eslint-disable no-console -- CLI tool, console is the output channel */

import pool from '@/lib/db';
import { fetchPhotoAsBase64 } from '@/modules/activate/services/photoFetchService';
import { resolveInternalPhotoUrl } from '@/lib/internalPhotoUrl';
import { computeDHash } from '@/lib/imageHash';

interface Row {
  id: string;
  photo_url: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const limArg = argv.indexOf('--limit');
  const limit = limArg >= 0 ? Number(argv[limArg + 1]) : null;

  const { rows } = await pool.query<Row>(
    `SELECT id, photo_url
       FROM vlm_visual_photo_examples
      WHERE phash IS NULL
      ORDER BY saved_at DESC
      ${limit ? `LIMIT ${limit}` : ''}`,
  );

  console.log(`Rows needing a phash: ${rows.length}${dry ? ' (dry run — no writes)' : ''}\n`);
  let ok = 0, failed = 0;

  for (const row of rows) {
    try {
      const b64 = await fetchPhotoAsBase64(resolveInternalPhotoUrl(row.photo_url));
      const phash = await computeDHash(b64);
      if (!phash) {
        failed++;
        console.log(`  SKIP (undecodable) ${row.photo_url}`);
        continue;
      }
      if (!dry) {
        await pool.query(`UPDATE vlm_visual_photo_examples SET phash = $1 WHERE id = $2`, [phash, row.id]);
      }
      ok++;
      if (ok % 25 === 0) console.log(`  …${ok} hashed`);
    } catch (err) {
      failed++;
      console.log(`  FAIL ${row.photo_url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone. Hashed: ${ok}  Failed/skipped: ${failed}`);
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
