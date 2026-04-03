/**
 * Snag Photo Mapper — maps uploaded TQR images to snag records.
 * Extracted from import-pdf.ts to keep files under 300 lines.
 *
 * WORKING: Grid-mapped (with GPS + pole_reference) and round-robin fallback.
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { Snag, SnagPhoto } from '@/modules/construction-qa/types/snag.types';
import type { TqrGridSlot } from '@/modules/construction-qa/services/tqr-pdf-parser';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Map uploaded photos to snags using the grid slot sequence.
 * Each slot carries snagNumber, latitude, longitude, and poleReference from the PDF.
 * Falls back to round-robin if grid parsing produced no slot data.
 */
export async function insertSnagPhotos(
  snags: Snag[],
  photos: Array<{ gridIndex: number; url: string; filename: string }>,
  gridSnagNumbers: number[],
  uploadedBy: string | null,
  gridSlots?: TqrGridSlot[]
): Promise<SnagPhoto[]> {
  if (snags.length === 0 || photos.length === 0) return [];

  // Build a map: snagNumber → snag record
  const snagByNumber = new Map<number, Snag>();
  for (const s of snags) {
    snagByNumber.set(s.snag_number, s);
  }

  const photoRecords: SnagPhoto[] = [];

  // Use grid mapping if grid has data. When photo count > grid count,
  // only map the first gridSnagNumbers.length photos (extras are compliance photos).
  const gridCount = gridSnagNumbers.length;
  const useGridMapping = gridCount > 0 && gridCount <= photos.length;

  if (useGridMapping) {
    // ── Grid-mapped assignment (with GPS metadata when available) ──────
    for (let i = 0; i < gridCount; i++) {
      const snagNum = gridSnagNumbers[i];
      if (snagNum === undefined) continue;
      const snag = snagByNumber.get(snagNum);
      if (!snag) continue;

      const photoUrl = photos[i]?.url;
      if (!photoUrl) continue;

      // Pull GPS + pole ref from slots if available
      const slot = gridSlots?.[i];
      const latitude      = slot?.latitude      ?? null;
      const longitude     = slot?.longitude     ?? null;
      const poleReference = slot?.poleReference ?? null;

      const rows = await sql`
        INSERT INTO snag_photos (
          snag_id, phase, photo_url, pole_reference,
          latitude, longitude, source, uploaded_by
        )
        VALUES (
          ${snag.id}, 'before', ${photoUrl}, ${poleReference},
          ${latitude}, ${longitude}, 'tqr_import', ${uploadedBy}
        )
        ON CONFLICT (snag_id, phase, photo_url) DO NOTHING
        RETURNING *
      ` as SnagPhoto[];

      if (rows[0]) photoRecords.push(rows[0]);
    }
  } else {
    // ── Round-robin fallback ───────────────────────────────────────────
    log.warn('SnagPhotoMapper: grid count mismatch, using round-robin', {
      gridNumbers: gridSnagNumbers.length,
      photoCount:  photos.length,
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
