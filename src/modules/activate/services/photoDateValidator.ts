/**
 * Photo Date Validator
 *
 * Extracts EXIF capture dates from DR photos and provides them
 * for date mismatch validation in the auto-QA pipeline.
 *
 * Photos taken more than 2 days before/after the DR submission date
 * are flagged for discard.
 */

import { log } from '@/lib/logger';
import { extractExifFromBuffer } from '@/lib/exifUtils';
import { fetchPhotoAsBase64 } from './photoFetchService';

const MODULE = 'PhotoDateValidator';

/**
 * Extract EXIF capture dates for a batch of photos.
 *
 * Returns a Map of filename → Date for photos where EXIF DateTimeOriginal
 * could be extracted. Photos without EXIF data are omitted from the map.
 */
export async function extractExifDatesForPhotos(
  dropNumber: string,
  photos: Array<{ filename: string; url: string }>
): Promise<Map<string, Date>> {
  const dateMap = new Map<string, Date>();

  // Process photos in parallel with concurrency limit
  const CONCURRENCY = 3;
  for (let i = 0; i < photos.length; i += CONCURRENCY) {
    const batch = photos.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (photo) => {
        try {
          const base64 = await fetchPhotoAsBase64(photo.url);
          const buffer = Buffer.from(base64, 'base64');
          const exif = await extractExifFromBuffer(buffer);

          if (exif.capturedAt) {
            dateMap.set(photo.filename, exif.capturedAt);
          }
        } catch (err) {
          log.warn(`EXIF extraction failed for ${photo.filename}`, {
            error: (err as Error).message,
            dropNumber,
          }, MODULE);
        }
      })
    );

    // Log any unexpected rejections
    for (const r of results) {
      if (r.status === 'rejected') {
        log.warn('Unexpected EXIF batch rejection', { reason: String(r.reason) }, MODULE);
      }
    }
  }

  log.info(`Extracted EXIF dates for ${dateMap.size}/${photos.length} photos`, {
    dropNumber,
  }, MODULE);

  return dateMap;
}
