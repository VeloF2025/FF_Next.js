/**
 * Snag-Per-Photo Import — creates one snag record per photo/pole instance.
 *
 * Each photo in the TQR grid is a unique issue at a specific pole.
 * The finding description is shared across all instances of the same finding number.
 *
 * WORKING: Grid-mapped with GPS + pole_reference per snag.
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { Snag, SnagPhoto } from '@/modules/construction-qa/types/snag.types';
import type { TqrFinding, TqrGridSlot } from '@/modules/construction-qa/services/tqr-pdf-parser';

const sql = neon(process.env.DATABASE_URL!);

interface UploadedPhoto {
  gridIndex: number;
  url: string;
  filename: string;
}

interface SnagPerPhotoResult {
  snags: Snag[];
  photos: SnagPhoto[];
}

/**
 * Create one snag per photo/pole instance from the TQR grid.
 *
 * Each grid slot maps to: finding description + pole ref + GPS + one before photo.
 * This means a finding with 14 photos at different poles becomes 14 separate snags.
 */
export async function createSnagsPerPhoto(
  reportId: string,
  projectId: string,
  findings: TqrFinding[],
  gridSlots: TqrGridSlot[],
  uploadedPhotos: UploadedPhoto[],
  uploadedBy: string | null
): Promise<SnagPerPhotoResult> {
  if (gridSlots.length === 0 && uploadedPhotos.length === 0) {
    return { snags: [], photos: [] };
  }

  // Build a lookup: finding number → description + category
  const findingMap = new Map<number, TqrFinding>();
  for (const f of findings) {
    findingMap.set(f.snagNumber, f);
  }

  const createdSnags: Snag[] = [];
  const createdPhotos: SnagPhoto[] = [];

  // Process each grid slot as an individual snag
  const slotCount = Math.min(gridSlots.length, uploadedPhotos.length);

  for (let i = 0; i < slotCount; i++) {
    const slot = gridSlots[i];
    const photo = uploadedPhotos[i];
    if (!slot || !photo) continue;

    const finding = findingMap.get(slot.snagNumber);
    if (!finding) {
      log.warn('SnagPerPhoto: no finding for slot', { index: i, snagNumber: slot.snagNumber });
      continue;
    }

    // Create snag with pole + GPS from this specific photo
    const poleRef = slot.poleReference ?? null;
    const poleRefs = poleRef ? [poleRef] : null;

    const snagRows = await sql`
      INSERT INTO snags (
        report_id, project_id, snag_number,
        category, severity, description,
        pole_references, status
      ) VALUES (
        ${reportId},
        ${projectId},
        ${slot.snagNumber},
        ${finding.category},
        'major',
        ${finding.description},
        ${poleRefs},
        'open'
      )
      RETURNING *
    ` as Snag[];

    const snag = snagRows[0];
    if (!snag) continue;
    createdSnags.push(snag);

    // Create the before photo linked to this specific snag
    const photoRows = await sql`
      INSERT INTO snag_photos (
        snag_id, phase, photo_url, pole_reference,
        latitude, longitude, source, uploaded_by
      )
      VALUES (
        ${snag.id}, 'before', ${photo.url}, ${poleRef},
        ${slot.latitude ?? null}, ${slot.longitude ?? null},
        'tqr_import', ${uploadedBy}
      )
      ON CONFLICT (snag_id, phase, photo_url) DO NOTHING
      RETURNING *
    ` as SnagPhoto[];

    if (photoRows[0]) createdPhotos.push(photoRows[0]);
  }

  // Handle extra photos beyond grid slots (compliance photos etc.)
  // These get no snag — they're just report-level documentation
  if (uploadedPhotos.length > slotCount) {
    log.info('SnagPerPhoto: extra photos beyond grid', {
      gridSlots: slotCount,
      totalPhotos: uploadedPhotos.length,
      extras: uploadedPhotos.length - slotCount,
    });
  }

  log.info('SnagPerPhoto: created', {
    snags: createdSnags.length,
    photos: createdPhotos.length,
  });

  return { snags: createdSnags, photos: createdPhotos };
}
