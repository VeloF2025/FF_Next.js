/**
 * EXIF / capture-date utilities for Construction QA photos.
 *
 * Two strategies:
 *   1. parseQFieldCaptureDate — extracts timestamp from QField filename pattern
 *      (no I/O, instant, works for all 5 834 QField photos)
 *   2. extractExifFromBuffer — reads EXIF DateTimeOriginal + GPS from image buffer
 *      (needs sharp + exif-reader, used for future non-QField sources)
 */

import { log } from '@/lib/logger';

const MODULE = 'exif-utils';

/**
 * QField storage keys encode capture time in the filename portion:
 *   projects/.../DCIM/law-poles_20251120145759971.JPG/v20251120130451-5e8d1c2f
 *   Pattern: _YYYYMMDDHHMMSSmmm  (mmm = milliseconds, may be absent)
 *
 * The filename is NOT the last segment (that's the version suffix).
 * We match the timestamp pattern anywhere in the key.
 */
const QF_TS_RE = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?\.(?:jpg|jpeg|png|gif|webp|heic)/i;

export function parseQFieldCaptureDate(storageKey: string): Date | null {
  const m = QF_TS_RE.exec(storageKey);
  if (!m) return null;

  const [, year, month, day, hour, min, sec, ms] = m;
  const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}.${ms || '000'}Z`;

  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    log.warn('Invalid QField capture date', { storageKey, iso }, MODULE);
    return null;
  }
  return d;
}

interface ExifResult {
  capturedAt?: Date;
  gpsLat?: number;
  gpsLon?: number;
}

/**
 * Extract EXIF metadata from an image buffer using sharp + exif-reader.
 * Returns DateTimeOriginal and GPS coordinates when available.
 */
export async function extractExifFromBuffer(buffer: Buffer): Promise<ExifResult> {
  const result: ExifResult = {};

  try {
    // Dynamic imports to keep module lightweight when only using parseQFieldCaptureDate
    const sharp = (await import('sharp')).default;
    const exifReader = (await import('exif-reader')).default;

    const metadata = await sharp(buffer).metadata();
    if (!metadata.exif) return result;

    const exif = exifReader(metadata.exif);

    // DateTimeOriginal
    if (exif?.Photo?.DateTimeOriginal) {
      const dt = exif.Photo.DateTimeOriginal;
      if (dt instanceof Date && !isNaN(dt.getTime())) {
        result.capturedAt = dt;
      }
    }

    // GPS coordinates
    if (exif?.GPSInfo) {
      const gps = exif.GPSInfo;
      if (gps.GPSLatitude != null && gps.GPSLongitude != null) {
        result.gpsLat = gps.GPSLatitude as unknown as number;
        result.gpsLon = gps.GPSLongitude as unknown as number;
      }
    }
  } catch (err) {
    log.warn('EXIF extraction failed', { error: (err as Error).message }, MODULE);
  }

  return result;
}
