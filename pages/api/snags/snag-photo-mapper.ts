/**
 * Snag Photo Mapper — maps uploaded TQR images to snag records.
 * Extracted from import-pdf.ts to keep files under 300 lines.
 *
 * WORKING: Grid-mapped and round-robin fallback assignment.
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { Snag, SnagPhoto } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Map uploaded photos to snags using the grid number sequence.
 * Falls back to round-robin if grid parsing produced no data.
 */
export async function insertSnagPhotos(
  snags: Snag[],
  photos: Array<{ gridIndex: number; url: string; filename: string }>,
  gridSnagNumbers: number[],
  uploadedBy: string | null
): Promise<SnagPhoto[]> {
  if (snags.length === 0 || photos.length === 0) return [];

  // Build a map: snagNumber → snag record
  const snagByNumber = new Map<number, Snag>();
  for (const s of snags) {
    snagByNumber.set(s.snag_number, s);
  }

  const photoRecords: SnagPhoto[] = [];

  if (gridSnagNumbers.length === photos.length) {
    // ── Grid-mapped assignment ─────────────────────────────
    for (let i = 0; i < photos.length; i++) {
      const snagNum = gridSnagNumbers[i];
      if (snagNum === undefined) continue;
      const snag    = snagByNumber.get(snagNum);
      if (!snag) continue;

      const photoUrl = photos[i]?.url;
      if (!photoUrl) continue;

      const rows = await sql`
        INSERT INTO snag_photos (snag_id, phase, photo_url, source, uploaded_by)
        VALUES (${snag.id}, 'before', ${photoUrl}, 'tqr_import', ${uploadedBy})
        ON CONFLICT (snag_id, phase, photo_url) DO NOTHING
        RETURNING *
      ` as SnagPhoto[];

      if (rows[0]) photoRecords.push(rows[0]);
    }
  } else {
    // ── Round-robin fallback ───────────────────────────────
    log.warn('SnagPhotoMapper: grid count mismatch, using round-robin', {
      gridNumbers: gridSnagNumbers.length,
      photoCount: photos.length,
    });

    for (let i = 0; i < photos.length; i++) {
      const snag = snags[i % snags.length];
      if (!snag) continue;
      const photoUrl = photos[i]?.url;
      if (!photoUrl) continue;

      const rows = await sql`
        INSERT INTO snag_photos (snag_id, phase, photo_url, source, uploaded_by)
        VALUES (${snag.id}, 'before', ${photoUrl}, 'tqr_import', ${uploadedBy})
        ON CONFLICT (snag_id, phase, photo_url) DO NOTHING
        RETURNING *
      ` as SnagPhoto[];

      if (rows[0]) photoRecords.push(rows[0]);
    }
  }

  return photoRecords;
}
