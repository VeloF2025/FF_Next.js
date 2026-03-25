/**
 * Photo Hash Service
 *
 * Computes SHA-256 hashes for DR photos and detects cross-DR duplicates.
 * Learns from human operator decisions: when a photo is marked as step -1
 * (Duplicate Photo), its hash is recorded so future DRs with the same
 * photo are automatically flagged.
 */

import { createHash } from 'crypto';
import pool from '@/lib/db';
import { log } from '@/lib/logger';

const VPS_PHOTO_API = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';
const VELOCITY_PHOTO_API = process.env.VELOCITY_PHOTO_URL || 'http://100.96.203.105:8003';

/**
 * Compute SHA-256 hash of a buffer
 */
export function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Resolve a photo proxy URL to its internal server URL
 */
function resolvePhotoUrl(proxyUrl: string): string {
  // Already absolute
  if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
    return proxyUrl;
  }

  // Parse proxy URL: /api/activate/photo/{drNumber}/{filename}
  const match = proxyUrl.match(/\/api\/activate\/photo\/([^/]+)\/(.+)$/);
  if (!match) return proxyUrl;

  const [, drNumber, filename] = match;
  const isWa = filename!.toLowerCase().startsWith('wa_');

  if (isWa) {
    return `${VPS_PHOTO_API}/photos/${drNumber}/${filename}`;
  }
  return `${VELOCITY_PHOTO_API}/api/photo/${drNumber}/${filename}`;
}

/**
 * Fetch a photo and compute its SHA-256 hash
 */
export async function fetchAndHashPhoto(photoUrl: string): Promise<string | null> {
  try {
    const internalUrl = resolvePhotoUrl(photoUrl);
    const response = await fetch(internalUrl, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      log.warn('PhotoHash', `Failed to fetch photo for hashing: ${response.status}`, { photoUrl });
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return computeHash(buffer);
  } catch (error) {
    log.warn('PhotoHash', 'Error fetching photo for hashing', { photoUrl, error });
    return null;
  }
}

/**
 * Store photo hashes in the database (upsert)
 */
export async function storePhotoHashes(
  dropNumber: string,
  photos: Array<{ filename: string; hash: string }>
): Promise<void> {
  if (photos.length === 0) return;

  try {
    for (const photo of photos) {
      await pool.query(
        `INSERT INTO photo_content_hashes (drop_number, filename, sha256_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (drop_number, filename)
         DO UPDATE SET sha256_hash = EXCLUDED.sha256_hash`,
        [dropNumber, photo.filename, photo.hash]
      );
    }
    log.info('PhotoHash', `Stored ${photos.length} hashes for ${dropNumber}`);
  } catch (error) {
    log.error('PhotoHash', 'Error storing photo hashes', { dropNumber, error });
  }
}

/**
 * Find cross-DR duplicates: photos whose hash matches a hash that a human
 * has previously marked as duplicate (step -1) in a DIFFERENT DR.
 *
 * Returns a map of filename → array of DR numbers where the same photo was flagged.
 */
export async function findCrossDRDuplicates(
  dropNumber: string,
  photos: Array<{ filename: string; hash: string }>
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (photos.length === 0) return result;

  try {
    const hashes = photos.map(p => p.hash);

    // Find hashes that exist in OTHER DRs AND have been marked as duplicate by a human
    const rows = await pool.query(
      `SELECT sha256_hash, drop_number
       FROM photo_content_hashes
       WHERE sha256_hash = ANY($1)
         AND drop_number != $2
         AND marked_duplicate_by IS NOT NULL
       ORDER BY created_at DESC`,
      [hashes, dropNumber]
    );

    // Build hash → DR numbers map
    const hashToDRs = new Map<string, string[]>();
    for (const row of rows.rows) {
      const existing = hashToDRs.get(row.sha256_hash) || [];
      existing.push(row.drop_number);
      hashToDRs.set(row.sha256_hash, existing);
    }

    // Map back to filenames
    for (const photo of photos) {
      const drs = hashToDRs.get(photo.hash);
      if (drs && drs.length > 0) {
        result.set(photo.filename, drs);
      }
    }

    if (result.size > 0) {
      log.info('PhotoHash', `Found ${result.size} cross-DR duplicate(s) for ${dropNumber}`, {
        duplicates: Object.fromEntries(result),
      });
    }
  } catch (error) {
    log.error('PhotoHash', 'Error checking cross-DR duplicates', { dropNumber, error });
  }

  return result;
}

/**
 * Record that a human marked a photo as duplicate (step -1).
 * Updates the hash record so future DRs with the same hash are auto-detected.
 */
export async function recordHumanDuplicateDecision(
  dropNumber: string,
  filename: string,
  userId: string
): Promise<void> {
  try {
    await pool.query(
      `UPDATE photo_content_hashes
       SET marked_duplicate_by = $1, marked_duplicate_at = NOW()
       WHERE drop_number = $2 AND filename = $3`,
      [userId, dropNumber, filename]
    );
    log.info('PhotoHash', `Recorded human duplicate decision for ${dropNumber}/${filename} by ${userId}`);
  } catch (error) {
    log.error('PhotoHash', 'Error recording duplicate decision', { dropNumber, filename, error });
  }
}
