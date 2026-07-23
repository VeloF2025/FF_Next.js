/**
 * OneMap Backfill Service
 *
 * Repairs DRs whose 1Map photo ingest was incomplete — including the PARTIAL
 * case (some photos landed, not all), which a photo_count-based query cannot
 * see because the count looks fine, it is just wrong.
 *
 * Used by pages/api/cron/backfill-onemap-data.ts.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { photoTypeToStep } from '@/modules/activate/utils/stepMapper';

const log = createLogger('OneMapBackfill');

const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';

// Nobody is waiting on this job, so it gets far more headroom than the 8s
// interactive ack path — a degraded 1Map answers in 10-30s and we still want
// the photos.
export const RECORD_TIMEOUT_MS = 30_000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface BackfillResult {
  dropNumber: string;
  success: boolean;
  photoCount: number;
  ontSerial: string | null;
  upsSerial: string | null;
  skippedWrite?: boolean;
  error?: string;
}

interface OneMapLocalPhoto {
  filename?: string;
  type?: string;
  size?: number;
  modified?: string;
}

/**
 * Decide whether a freshly-fetched photo set may overwrite what is stored.
 *
 * The job must never leave a DR worse off than it found it. 1Map returning a
 * shorter list than we already hold means something is wrong upstream (a cache
 * eviction, a download that had not finished, a still-degraded backend) — not
 * that the technician's photos vanished. In that case we keep the stored set
 * and record the discrepancy so the DR is looked at again.
 *
 * Pure function — the branching here is what the unit tests pin down.
 */
export function decidePhotoWrite(
  existingCount: number,
  fetchedCount: number,
  cloudCount: number
): { writePhotos: boolean; mismatch: boolean; reason: string } {
  if (fetchedCount < existingCount) {
    return {
      writePhotos: false,
      mismatch: true,
      reason: `fetched ${fetchedCount} < stored ${existingCount} — refusing to shrink stored set`,
    };
  }
  return {
    writePhotos: true,
    mismatch: fetchedCount < cloudCount,
    reason: fetchedCount < cloudCount
      ? `still short: ${fetchedCount}/${cloudCount}`
      : `complete: ${fetchedCount}/${cloudCount}`,
  };
}

/**
 * Extract ONT serial from barcode data
 * Format: (S)SERIAL(23S)CODE... → extracts SERIAL
 */
export function extractOntSerial(barcodeData: string | null): string | null {
  if (!barcodeData) return null;

  const serialMatch = barcodeData.match(/\(S\)([^(]+)/);
  if (serialMatch && serialMatch[1]) {
    return serialMatch[1].trim();
  }

  if (!barcodeData.includes('(')) {
    return barcodeData.trim();
  }

  return null;
}

/**
 * Record an attempt that could not confirm the photo set — upstream was
 * unreachable, slow, or errored. Stamping the attempt is what gives failures a
 * backoff; without it a permanently-failing DR is reselected on every tick and
 * starves the rest of the backlog. photo data is deliberately left untouched.
 */
async function recordUnconfirmedAttempt(dropNumber: string): Promise<void> {
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET photo_count_verified_at = NOW(),
         photo_count_mismatch = TRUE,
         updated_at = NOW()
     WHERE drop_number = $1`,
    [dropNumber]
  );
}

/**
 * Fetch a DR from 1Map (via BOSS) and reconcile our stored photo set with it.
 */
export async function backfillDr(dropNumber: string): Promise<BackfillResult> {
  const result: BackfillResult = {
    dropNumber,
    success: false,
    photoCount: 0,
    ontSerial: null,
    upsSerial: null,
  };

  try {
    const existing = await pool.query<{ photo_count: number | null }>(
      `SELECT photo_count FROM dr_photo_unified_reviews WHERE drop_number = $1`,
      [dropNumber]
    );
    const existingCount = existing.rows[0]?.photo_count ?? 0;

    let response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
      signal: AbortSignal.timeout(RECORD_TIMEOUT_MS),
    });

    // If 404, try to trigger download
    if (response.status === 404 || response.status === 422) {
      log.info(`Record not found, triggering download for ${dropNumber}`);

      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      if (downloadResponse.ok) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
          signal: AbortSignal.timeout(RECORD_TIMEOUT_MS),
        });
      }
    }

    if (!response.ok) {
      result.error = `OneMap API returned ${response.status}`;
      await recordUnconfirmedAttempt(dropNumber);
      return result;
    }

    const data = await response.json();
    let localPhotos: OneMapLocalPhoto[] = data.local_photos || [];
    let cloudPhotoCount: number = data.photo_count || 0;

    // Any shortfall triggers a re-download, not just a total absence. A DR that
    // ingested 5 of its 10 photos is just as broken for QA as one that got zero.
    if (cloudPhotoCount > localPhotos.length) {
      log.info(`Incomplete photo set for ${dropNumber}, triggering download`, {
        localCount: localPhotos.length,
        cloudCount: cloudPhotoCount,
      });

      await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      const retryResponse = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
        signal: AbortSignal.timeout(RECORD_TIMEOUT_MS),
      });

      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        localPhotos = retryData.local_photos || [];
        cloudPhotoCount = retryData.photo_count || cloudPhotoCount;
        if (retryData.ont_barcode) data.ont_barcode = retryData.ont_barcode;
        if (retryData.ups_serial) data.ups_serial = retryData.ups_serial;
      }
    }

    const photos = localPhotos
      .filter((photo) => !!photo.filename)
      .map((photo) => ({
        filename: photo.filename,
        step: photoTypeToStep(photo.type ?? '') ?? 0,
        url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
        size: photo.size,
        modified: photo.modified,
        original_type: photo.type,
      }));

    const ontSerial = extractOntSerial(data.ont_barcode);
    const upsSerial = data.ups_serial || null;
    const decision = decidePhotoWrite(existingCount, photos.length, cloudPhotoCount);

    if (decision.writePhotos) {
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           photo_source = 'onemap',
           photo_count = $1,
           photos_metadata = $2,
           ont_serial_scanned = COALESCE($3, ont_serial_scanned),
           ups_serial_scanned = COALESCE($4, ups_serial_scanned),
           photo_count_verified_at = NOW(),
           photo_count_mismatch = $5,
           updated_at = NOW()
         WHERE drop_number = $6`,
        [photos.length, JSON.stringify(photos), ontSerial, upsSerial, decision.mismatch, dropNumber]
      );
      result.photoCount = photos.length;
    } else {
      // Serials are still worth taking — only the photo set is held back.
      log.warn(`Refusing to shrink photo set for ${dropNumber}`, { reason: decision.reason });
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           ont_serial_scanned = COALESCE($1, ont_serial_scanned),
           ups_serial_scanned = COALESCE($2, ups_serial_scanned),
           photo_count_verified_at = NOW(),
           photo_count_mismatch = TRUE,
           updated_at = NOW()
         WHERE drop_number = $3`,
        [ontSerial, upsSerial, dropNumber]
      );
      result.photoCount = existingCount;
      result.skippedWrite = true;
    }

    result.success = true;
    result.ontSerial = ontSerial;
    result.upsSerial = upsSerial;

    log.info(`Updated ${dropNumber}`, {
      photoCount: result.photoCount,
      ontSerial,
      upsSerial,
      decision: decision.reason,
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Error processing ${dropNumber}`, { error: result.error });
    try {
      await recordUnconfirmedAttempt(dropNumber);
    } catch (stampError) {
      // Backoff is best-effort; a DB blip here must not mask the original error.
      log.warn(`Could not record attempt for ${dropNumber}`, { error: stampError });
    }
    return result;
  }
}
