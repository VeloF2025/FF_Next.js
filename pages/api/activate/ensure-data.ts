/**
 * API Route: /api/activate/ensure-data
 *
 * Purpose: Ensure DR has latest data before QA review
 * Method: POST
 *
 * Called when user opens DR for QA review (QA Wizard).
 * Checks if data is complete, auto-refreshes from OneMap if missing.
 *
 * Strategy:
 * - If photos/serials already present → return immediately (fast path)
 * - If missing → fetch from OneMap → update DB → return
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { photoTypeToStep } from '@/modules/activate/utils/stepMapper';
import { logPhotosSynced } from '@/modules/activate/services/activityLogService';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// BOSS API - Docker container on Velocity that caches 1Map photo data
// LEGITIMATE USE: This endpoint is called once when opening QA Wizard
// to ensure photos are downloaded for review (not on every page view)
const BOSS_API_HOST = 'http://100.96.203.105:8003';

interface EnsureDataRequest {
  dropNumber: string;
  force?: boolean; // Force refresh even if data exists
}

interface EnsureDataResponse {
  status: 'complete' | 'refreshed' | 'partial' | 'not_found';
  photoCount: number;
  hasPhotos: boolean;
  hasOntSerial: boolean;
  hasUpsSerial: boolean;
  refreshed: boolean;
  refreshedAt: string | null;
  message: string;
}

/**
 * POST /api/activate/ensure-data
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, force } = req.body as EnsureDataRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('EnsureData', `Checking data completeness for ${dropNumber}`, { force });

    // 1. Check current data in unified table
    const existingResult = await pool.query(
      `SELECT
         photo_count,
         photos_metadata,
         photo_source,
         ont_serial_scanned,
         ups_serial_scanned,
         updated_at
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (existingResult.rows.length === 0) {
      // DR not in unified table - check if it exists in qa_photo_reviews or oes_activations
      const qaResult = await pool.query(
        `SELECT drop_number FROM qa_photo_reviews WHERE drop_number = $1 LIMIT 1`,
        [dropNumber]
      );
      const oesResult = await pool.query(
        `SELECT drop_number FROM oes_activations WHERE drop_number = $1 LIMIT 1`,
        [dropNumber]
      );

      if (qaResult.rows.length === 0 && oesResult.rows.length === 0) {
        return apiResponse.success(res, {
          status: 'not_found',
          photoCount: 0,
          hasPhotos: false,
          hasOntSerial: false,
          hasUpsSerial: false,
          refreshed: false,
          refreshedAt: null,
          message: 'DR not found in system',
        } as EnsureDataResponse);
      }

      // Create unified record and fetch data
      log.info('EnsureData', `Creating unified record for ${dropNumber}`);
      await pool.query(
        `INSERT INTO dr_photo_unified_reviews (drop_number, created_at, updated_at)
         VALUES ($1, NOW(), NOW())
         ON CONFLICT (drop_number) DO NOTHING`,
        [dropNumber]
      );

      // Fetch data from OneMap (new record, so previous count is 0)
      const fetchResult = await fetchAndUpdateFromOneMap(dropNumber, 0);

      return apiResponse.success(res, {
        status: fetchResult.photoCount > 0 ? 'refreshed' : 'partial',
        photoCount: fetchResult.photoCount,
        hasPhotos: fetchResult.photoCount > 0,
        hasOntSerial: !!fetchResult.ontSerial,
        hasUpsSerial: !!fetchResult.upsSerial,
        refreshed: true,
        refreshedAt: new Date().toISOString(),
        message: fetchResult.photoCount > 0
          ? `Fetched ${fetchResult.photoCount} photos from OneMap`
          : 'Record created but no photos available on OneMap yet',
      } as EnsureDataResponse);
    }

    // 2. Check data completeness
    const existing = existingResult.rows[0];
    const photoCount = existing.photo_count || 0;
    const photosMetadata = existing.photos_metadata || [];
    const hasPhotos = photoCount > 0 && Array.isArray(photosMetadata) && photosMetadata.length > 0;
    const hasOntSerial = !!existing.ont_serial_scanned;
    const hasUpsSerial = !!existing.ups_serial_scanned;

    // Check if 1Map has more ACTUAL photos than we have in DB
    // Use localCount (downloadable) not cloudCount (metadata with orphaned entries)
    const oneMapCheck = await check1MapPhotoCount(dropNumber);
    const needsPhotoSync = oneMapCheck.localCount > photoCount;

    if (needsPhotoSync) {
      log.info('EnsureData', `1Map has more downloadable photos for ${dropNumber}`, {
        dbCount: photoCount,
        availableCount: oneMapCheck.localCount,
        cloudMetadata: oneMapCheck.cloudCount,
        hasOrphanedMetadata: oneMapCheck.hasOrphanedMetadata,
      });
    }

    // Log and record verification: our DB matches actual available photos
    if (!needsPhotoSync && photoCount > 0 && oneMapCheck.localCount > 0) {
      log.debug('EnsureData', `Photo count verified for ${dropNumber}`, {
        dbCount: photoCount,
        availableCount: oneMapCheck.localCount,
        match: photoCount === oneMapCheck.localCount,
      });

      // Update verification timestamp (async, don't block response)
      markPhotoCountVerified(dropNumber, photoCount, oneMapCheck.localCount).catch((err) => {
        log.warn('EnsureData', `Failed to mark verification for ${dropNumber}`, { error: err });
      });
    }

    // Fast path: Data is complete, not forced, and no new photos in 1Map
    if (!force && !needsPhotoSync && hasPhotos && (hasOntSerial || hasUpsSerial)) {
      log.info('EnsureData', `Data complete for ${dropNumber}`, {
        photoCount,
        hasOntSerial,
        hasUpsSerial,
        ms: Date.now() - startTime,
      });

      return apiResponse.success(res, {
        status: 'complete',
        photoCount,
        hasPhotos,
        hasOntSerial,
        hasUpsSerial,
        refreshed: false,
        refreshedAt: existing.updated_at?.toISOString() || null,
        message: 'Data already complete',
      } as EnsureDataResponse);
    }

    // 3. Data incomplete, force refresh, or new photos available - fetch from OneMap
    const refreshReason = force ? 'forced' : needsPhotoSync ? 'new_photos_available' : 'incomplete';
    log.info('EnsureData', `Refreshing data for ${dropNumber}`, {
      reason: refreshReason,
      hasPhotos,
      hasOntSerial,
      hasUpsSerial,
      needsPhotoSync,
    });

    const fetchResult = await fetchAndUpdateFromOneMap(dropNumber, photoCount);

    // Determine final status
    const finalHasPhotos = fetchResult.photoCount > 0;
    const finalHasOntSerial = !!fetchResult.ontSerial || hasOntSerial;
    const finalHasUpsSerial = !!fetchResult.upsSerial || hasUpsSerial;
    const isComplete = finalHasPhotos && (finalHasOntSerial || finalHasUpsSerial);

    log.info('EnsureData', `Refresh complete for ${dropNumber}`, {
      status: isComplete ? 'refreshed' : 'partial',
      photoCount: fetchResult.photoCount,
      hasOntSerial: finalHasOntSerial,
      hasUpsSerial: finalHasUpsSerial,
      ms: Date.now() - startTime,
    });

    return apiResponse.success(res, {
      status: isComplete ? 'refreshed' : 'partial',
      photoCount: fetchResult.photoCount,
      hasPhotos: finalHasPhotos,
      hasOntSerial: finalHasOntSerial,
      hasUpsSerial: finalHasUpsSerial,
      refreshed: true,
      refreshedAt: new Date().toISOString(),
      message: isComplete
        ? `Refreshed: ${fetchResult.photoCount} photos`
        : `Partial data: ${!finalHasPhotos ? 'no photos' : ''}${!finalHasOntSerial && !finalHasUpsSerial ? ' no serials' : ''}`.trim(),
    } as EnsureDataResponse);
  } catch (error) {
    log.error('EnsureData', 'Error ensuring data', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Check how many photos 1Map has for this DR (cloud metadata vs local downloaded)
 *
 * IMPORTANT: Use `localCount` as source of truth for available photos.
 * `cloudCount` (metadata) can be higher due to orphaned entries in 1Map
 * where photo references exist but actual files return placeholder GIFs.
 */
async function check1MapPhotoCount(dropNumber: string): Promise<{
  cloudCount: number;  // Metadata count (may include orphaned entries)
  localCount: number;  // Actually downloadable photos (source of truth)
  hasOrphanedMetadata: boolean;
}> {
  try {
    const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return { cloudCount: 0, localCount: 0, hasOrphanedMetadata: false };
    }

    const data = await response.json();
    const cloudCount = data.photo_count || 0;
    const localCount = data.local_photos?.length || 0;

    // Log if there's orphaned metadata (cloud > local means some photos aren't actually available)
    if (cloudCount > localCount && localCount > 0) {
      log.info('EnsureData', `Orphaned 1Map metadata detected for ${dropNumber}`, {
        cloudMetadata: cloudCount,
        actualPhotos: localCount,
        orphaned: cloudCount - localCount,
      });
    }

    return {
      cloudCount,
      localCount,
      hasOrphanedMetadata: cloudCount > localCount,
    };
  } catch (error) {
    log.warn('EnsureData', `Failed to check 1Map photo count for ${dropNumber}`, { error });
    return { cloudCount: 0, localCount: 0, hasOrphanedMetadata: false };
  }
}

/**
 * Fetch data from OneMap and update unified table
 */
async function fetchAndUpdateFromOneMap(dropNumber: string, previousPhotoCount: number = 0): Promise<{
  photoCount: number;
  ontSerial: string | null;
  upsSerial: string | null;
}> {
  try {
    // Try to get record from OneMap
    let response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    // If 404, try to trigger download
    if (response.status === 404 || response.status === 422) {
      log.info('EnsureData', `Record not found on OneMap, triggering download for ${dropNumber}`);

      const downloadResponse = await fetch(`${BOSS_API_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000), // 15s timeout for download
      });

      if (downloadResponse.ok) {
        // Wait a moment for photos to be available
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Retry fetch
        response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
          signal: AbortSignal.timeout(10000),
        });
      }
    }

    if (!response.ok) {
      log.warn('EnsureData', `OneMap fetch failed for ${dropNumber}`, { status: response.status });
      return { photoCount: 0, ontSerial: null, upsSerial: null };
    }

    const data = await response.json();
    let localPhotos = data.local_photos || [];
    const cloudPhotoCount = data.photo_count || 0;

    // If cloud has more photos than local, trigger download to get ALL photos
    if (cloudPhotoCount > localPhotos.length) {
      log.info('EnsureData', `Cloud has more photos than local for ${dropNumber}`, {
        cloudCount: cloudPhotoCount,
        localCount: localPhotos.length,
      });

      const downloadResponse = await fetch(`${BOSS_API_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
        signal: AbortSignal.timeout(60000), // 60s timeout for large downloads
      });

      if (downloadResponse.ok) {
        // Wait for photos to be processed
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Retry fetch to get updated local_photos
        const retryResponse = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
          signal: AbortSignal.timeout(10000),
        });

        if (retryResponse.ok) {
          const retryData = await retryResponse.json();
          localPhotos = retryData.local_photos || [];
          log.info('EnsureData', `After download: ${localPhotos.length} local photos for ${dropNumber}`);
        }
      }
    }

    // Update unified table with fetched data
    await updateUnifiedTable(dropNumber, localPhotos, data.ont_barcode, data.ups_serial);

    // Log photo sync event if photos were added
    const newPhotoCount = localPhotos.length;
    if (newPhotoCount > previousPhotoCount) {
      try {
        await logPhotosSynced(dropNumber, previousPhotoCount, newPhotoCount, '1Map', 'qa_wizard');
        log.info('EnsureData', `Logged photo sync for ${dropNumber}: ${previousPhotoCount} → ${newPhotoCount}`);
      } catch (logError) {
        log.warn('EnsureData', `Failed to log photo sync for ${dropNumber}`, { error: logError });
      }
    }

    return {
      photoCount: newPhotoCount,
      ontSerial: extractOntSerial(data.ont_barcode),
      upsSerial: data.ups_serial || null,
    };
  } catch (error) {
    log.error('EnsureData', `OneMap fetch error for ${dropNumber}`, error);
    return { photoCount: 0, ontSerial: null, upsSerial: null };
  }
}

/**
 * Update unified table with photo and serial data
 * Also marks photo count as verified (matching actual 1Map availability)
 */
async function updateUnifiedTable(
  dropNumber: string,
  localPhotos: any[],
  ontBarcode: string | null,
  upsSerial: string | null
): Promise<void> {
  // Map photos to our format
  const photos = localPhotos.map((photo: any) => ({
    filename: photo.filename,
    step: photoTypeToStep(photo.type) ?? 0,
    url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
    size: photo.size,
    modified: photo.modified,
    original_type: photo.type,
  }));

  const ontSerial = extractOntSerial(ontBarcode);

  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       photo_source = 'onemap',
       photo_count = $1,
       photos_metadata = $2,
       ont_serial_scanned = COALESCE($3, ont_serial_scanned),
       ups_serial_scanned = COALESCE($4, ups_serial_scanned),
       photos_fetched_at = COALESCE(photos_fetched_at, NOW()),
       photo_count_verified_at = NOW(),
       photo_count_mismatch = FALSE,
       updated_at = NOW()
     WHERE drop_number = $5`,
    [photos.length, JSON.stringify(photos), ontSerial, upsSerial, dropNumber]
  );
}

/**
 * Mark photo count as verified without updating photos
 * Used when we confirm DB count matches 1Map available count
 */
async function markPhotoCountVerified(
  dropNumber: string,
  dbCount: number,
  availableCount: number
): Promise<void> {
  const mismatch = dbCount !== availableCount;
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       photo_count_verified_at = NOW(),
       photo_count_mismatch = $1
     WHERE drop_number = $2`,
    [mismatch, dropNumber]
  );
}

/**
 * Extract ONT serial from barcode data
 * Format: (S)SERIAL(23S)CODE... → extracts SERIAL
 */
function extractOntSerial(barcodeData: string | null): string | null {
  if (!barcodeData) return null;

  // Pattern: (S)SERIAL(23S)...
  const serialMatch = barcodeData.match(/\(S\)([^(]+)/);
  if (serialMatch && serialMatch[1]) {
    return serialMatch[1].trim();
  }

  // If no pattern, return raw barcode (might already be clean serial)
  if (!barcodeData.includes('(')) {
    return barcodeData.trim();
  }

  return null;
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  return handlePost(req, res);
}

export default withAuth(handler);
