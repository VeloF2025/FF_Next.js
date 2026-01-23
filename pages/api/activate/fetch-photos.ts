/**
 * API Route: /api/activate/fetch-photos
 *
 * Purpose: Fetch photos for a DR using multi-source fallback strategy
 * Method: POST
 *
 * Following FibreFlow standards:
 * - Uses apiResponse helper for consistent responses
 * - Neon PostgreSQL with ep-dry-night-a9qyh4sj endpoint
 * - Proper error handling and logging
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { UnifiedReview } from '@/modules/activate/types/unified.types';
import { photoTypeToStep } from '@/modules/activate/utils/stepMapper';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

// CRITICAL: Use correct Neon endpoint (ep-dry-night-a9qyh4sj)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

interface FetchPhotosRequest {
  dropNumber: string;
  forceSource?: 'onemap' | 'boss' | 'local'; // Optional: force specific source for testing
  force?: boolean; // Force re-fetch even if already fetched
  skipCategorization?: boolean; // If true, return photos without step mapping (for VLM categorization)
}

interface Photo {
  filename: string;
  step: number | null; // null when skipCategorization is true
  url: string;
  size?: number;
  modified?: number;
  original_type?: string; // Original OneMap type (for VLM categorization reference)
}

interface PhotoFetchResult {
  source: 'onemap' | 'boss' | 'local';
  photos: Photo[];
  count: number;
  ont_barcode?: string | null;
  ups_serial?: string | null;
  skipped?: boolean; // True if already fetched and not forced
}

/**
 * POST /api/activate/fetch-photos
 * Fetch photos using multi-source fallback strategy
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  try {
    const { dropNumber, forceSource, force, skipCategorization } = req.body as FetchPhotosRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info(`Fetching photos for ${dropNumber}`, { forceSource, force, skipCategorization });

    // Check if already fetched (skip unless forced)
    // NOTE: 'OES Import' is NOT a real photo source - it means record came from OES import
    // Only skip if photo_source is an actual photo source (onemap, boss, local)
    if (!force) {
      const existingResult = await pool.query(
        `SELECT photo_source, photo_count, photos_metadata, ont_serial_scanned, ups_serial_scanned,
                vlm_categorization_results, vlm_categorization_status
         FROM dr_photo_unified_reviews
         WHERE drop_number = $1 AND photo_source IN ('onemap', 'boss', 'local')`,
        [dropNumber]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        log.info(`Photos already fetched for ${dropNumber}, skipping`, {
          source: existing.photo_source,
          count: existing.photo_count,
          vlmStatus: existing.vlm_categorization_status,
        });

        // Use VLM categorization results for step data if available
        // This ensures accurate step coverage even if categorization isn't formally approved
        let photos = existing.photos_metadata || [];
        const vlmResults = existing.vlm_categorization_results || [];

        if (vlmResults.length > 0 && existing.vlm_categorization_status !== 'pending') {
          // Build photos array using VLM results for step data
          photos = vlmResults.map((vlm: any) => ({
            filename: vlm.photo_filename,
            step: vlm.human_override_step ?? vlm.vlm_predicted_step ?? null,
            url: `/api/activate/photo/${dropNumber}/${vlm.photo_filename}`,
            original_type: vlm.original_type,
          }));
          log.info(`Using VLM results for step data (${vlmResults.length} photos)`);
        }

        return apiResponse.success(res, {
          source: existing.photo_source,
          photos,
          count: existing.photo_count || 0,
          ont_barcode: existing.ont_serial_scanned,
          ups_serial: existing.ups_serial_scanned,
          skipped: true,
        });
      }
    }

    // Fetch photos with multi-source fallback
    const result = forceSource
      ? await fetchFromSpecificSource(dropNumber, forceSource, skipCategorization)
      : await fetchPhotosWithFallback(dropNumber, skipCategorization);

    // Update unified review with photo metadata and serial numbers
    await updateReviewWithPhotos(dropNumber, result);

    log.info(`Successfully fetched photos for ${dropNumber}`, {
      source: result.source,
      count: result.count,
      ont_barcode: result.ont_barcode,
      ups_serial: result.ups_serial,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    log.error('Error fetching photos:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Fetch photos with multi-source fallback (OneMap → BOSS → Local)
 * @param skipCategorization - If true, return photos with step=null (for VLM categorization)
 */
async function fetchPhotosWithFallback(
  dropNumber: string,
  skipCategorization?: boolean
): Promise<PhotoFetchResult> {
  // Try OneMap first (most reliable)
  try {
    log.info(`Trying OneMap for ${dropNumber}`);
    return await fetchFromOneMap(dropNumber, skipCategorization);
  } catch (error) {
    log.warn(`OneMap failed for ${dropNumber}`, { error });
  }

  // Fallback to BOSS API
  try {
    log.info(`Trying BOSS API for ${dropNumber}`);
    return await fetchFromBossApi(dropNumber, skipCategorization);
  } catch (error) {
    log.warn(`BOSS API failed for ${dropNumber}`, { error });
  }

  // Last resort: local cache
  try {
    log.info(`Trying local cache for ${dropNumber}`);
    return await fetchFromLocalCache(dropNumber);
  } catch (error) {
    log.warn(`All sources failed for ${dropNumber}`, { error });
    // Return empty result instead of throwing - graceful degradation
    return {
      source: 'local',
      photos: [],
      count: 0,
    };
  }
}

/**
 * Fetch from specific source (for testing)
 * @param skipCategorization - If true, return photos with step=null (for VLM categorization)
 */
async function fetchFromSpecificSource(
  dropNumber: string,
  source: 'onemap' | 'boss' | 'local',
  skipCategorization?: boolean
): Promise<PhotoFetchResult> {
  switch (source) {
    case 'onemap':
      return await fetchFromOneMap(dropNumber, skipCategorization);
    case 'boss':
      return await fetchFromBossApi(dropNumber, skipCategorization);
    case 'local':
      return await fetchFromLocalCache(dropNumber);
    default:
      throw new Error(`Unknown source: ${source}`);
  }
}

const ONEMAP_HOST = 'http://100.96.203.105:8003';

/**
 * Fetch from OneMap GIS API (via port 8003)
 * Uses /api/record/ endpoint which includes photos AND serial numbers
 * If photos not found, triggers download from OneMap first
 * @param skipCategorization - If true, return step=null to let VLM categorize
 */
async function fetchFromOneMap(
  dropNumber: string,
  skipCategorization?: boolean
): Promise<PhotoFetchResult> {
  try {
    // First, try to get the full record (includes photos + serial numbers)
    let response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);

    // If 404, try to download photos first
    if (response.status === 404 || response.status === 422) {
      log.info(`Record not found for ${dropNumber}, triggering download from OneMap`);

      // Trigger download from OneMap
      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
      });

      if (downloadResponse.ok) {
        const downloadResult = await downloadResponse.json();
        log.info(`Download triggered for ${dropNumber}`, {
          photos_downloaded: downloadResult.photos_downloaded || downloadResult.total_photos
        });

        // Retry fetching record after download
        response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);
      } else {
        const errorText = await downloadResponse.text();
        log.warn(`Download failed for ${dropNumber}:`, { status: downloadResponse.status, error: errorText });
        throw new Error(`Download failed: ${downloadResponse.status}`);
      }
    }

    if (!response.ok) {
      throw new Error(`OneMap API error: ${response.status}`);
    }

    let data = await response.json();

    // Check if local_photos exists (full record response)
    let localPhotos = data.local_photos || [];
    if (!Array.isArray(localPhotos)) {
      log.warn(`No local_photos array in response for ${dropNumber}`, { data });
      return {
        source: 'onemap',
        photos: [],
        count: 0,
        ont_barcode: data.ont_barcode || null,
        ups_serial: data.ups_serial || null,
      };
    }

    // If record exists but local_photos is empty, try downloading
    if (localPhotos.length === 0 && data.photo_count > 0) {
      log.info(`Record exists but no local photos for ${dropNumber}, triggering download`);

      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
      });

      if (downloadResponse.ok) {
        // Re-fetch record after download
        const retryResponse = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);
        if (retryResponse.ok) {
          data = await retryResponse.json();
          localPhotos = data.local_photos || [];
          log.info(`Downloaded ${localPhotos.length} photos for ${dropNumber}`);
        }
      } else {
        log.warn(`Download failed for ${dropNumber}`);
      }
    }

    // Map OneMap response to our Photo interface with PROXY URLs
    // Use our proxy endpoint instead of internal IP to avoid:
    // 1. LAN IP not accessible from internet
    // 2. Mixed content (HTTPS -> HTTP) blocking
    // If skipCategorization is true, return step=null so VLM can categorize
    const photos: Photo[] = localPhotos.map((photo: any) => ({
      filename: photo.filename,
      step: skipCategorization ? null : (photoTypeToStep(photo.type) ?? 0),
      url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
      size: photo.size,
      modified: photo.modified,
      original_type: photo.type, // Store original OneMap type for VLM reference
    }));

    log.info(`Fetched record for ${dropNumber}`, {
      photo_count: photos.length,
      ont_barcode: data.ont_barcode,
      ups_serial: data.ups_serial,
    });

    return {
      source: 'onemap',
      photos,
      count: photos.length,
      ont_barcode: data.ont_barcode || null,
      ups_serial: data.ups_serial || null,
    };
  } catch (error) {
    log.error('OneMap fetch failed', { dropNumber, error });
    throw error;
  }
}

/**
 * Fetch from BOSS VPS API (port 8001)
 * @param skipCategorization - If true, return step=null to let VLM categorize
 */
async function fetchFromBossApi(
  dropNumber: string,
  skipCategorization?: boolean
): Promise<PhotoFetchResult> {
  try {
    const response = await fetch(`http://192.168.1.150:8001/api/photos/${dropNumber}`);

    if (!response.ok) {
      throw new Error(`BOSS API error: ${response.status}`);
    }

    const data = await response.json();

    // Map BOSS response to our Photo interface
    // If skipCategorization is true, return step=null so VLM can categorize
    const photos: Photo[] = data.photos.map((photo: any) => ({
      filename: photo.filename,
      step: skipCategorization ? null : (photoTypeToStep(photo.type) ?? 0),
      url: photo.url,
      size: photo.size,
      modified: photo.modified,
      original_type: photo.type, // Store original type for VLM reference
    }));

    return {
      source: 'boss',
      photos,
      count: photos.length,
    };
  } catch (error) {
    log.error('BOSS API fetch failed', { dropNumber, error });
    throw error;
  }
}

/**
 * Fetch from local filesystem cache
 */
async function fetchFromLocalCache(dropNumber: string): Promise<PhotoFetchResult> {
  // TODO: Implement local cache fetching (Phase 4 enhancement)
  // This would read from /srv/data/boss/dr_photos/ or similar
  throw new Error('Local cache not yet implemented');
}

/**
 * Update unified review with photo metadata and serial numbers
 */
async function updateReviewWithPhotos(
  dropNumber: string,
  result: PhotoFetchResult
): Promise<void> {
  try {
    await pool.query(
      `
      UPDATE dr_photo_unified_reviews
      SET
        photo_source = $1,
        photo_count = $2,
        photos_metadata = $3,
        ont_serial_scanned = COALESCE($4, ont_serial_scanned),
        ups_serial_scanned = COALESCE($5, ups_serial_scanned),
        updated_at = NOW()
      WHERE drop_number = $6;
      `,
      [
        result.source,
        result.count,
        JSON.stringify(result.photos),
        result.ont_barcode || null,
        result.ups_serial || null,
        dropNumber
      ]
    );

    log.info(`Updated review with photo metadata and serials for ${dropNumber}`, {
      ont_barcode: result.ont_barcode,
      ups_serial: result.ups_serial,
    });
  } catch (error) {
    log.error('Failed to update review with photos', { dropNumber, error });
    // Don't throw - we still want to return the photos even if DB update fails
  }
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res);
  }

  return handlePost(req, res);
}
