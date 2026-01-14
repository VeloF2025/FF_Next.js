/**
 * API Route: /api/dr-photo-unified/fetch-photos
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
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { UnifiedReview } from '@/modules/dr-photo-unified/types/unified.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

// CRITICAL: Use correct Neon endpoint (ep-dry-night-a9qyh4sj)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

interface FetchPhotosRequest {
  dropNumber: string;
  forceSource?: 'onemap' | 'boss' | 'local'; // Optional: force specific source for testing
}

interface Photo {
  filename: string;
  step: number;
  url: string;
  size?: number;
  modified?: number;
}

interface PhotoFetchResult {
  source: 'onemap' | 'boss' | 'local';
  photos: Photo[];
  count: number;
}

/**
 * POST /api/dr-photo-unified/fetch-photos
 * Fetch photos using multi-source fallback strategy
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  try {
    const { dropNumber, forceSource } = req.body as FetchPhotosRequest;

    if (!dropNumber) {
      return apiResponse.badRequest(res, 'dropNumber is required');
    }

    log.info(`Fetching photos for ${dropNumber}`, { forceSource });

    // Fetch photos with multi-source fallback
    const result = forceSource
      ? await fetchFromSpecificSource(dropNumber, forceSource)
      : await fetchPhotosWithFallback(dropNumber);

    // Update unified review with photo metadata
    await updateReviewWithPhotos(dropNumber, result);

    log.info(`Successfully fetched photos for ${dropNumber}`, {
      source: result.source,
      count: result.count,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    log.error('Error fetching photos:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Fetch photos with multi-source fallback (OneMap → BOSS → Local)
 */
async function fetchPhotosWithFallback(dropNumber: string): Promise<PhotoFetchResult> {
  // Try OneMap first (most reliable)
  try {
    log.info(`Trying OneMap for ${dropNumber}`);
    return await fetchFromOneMap(dropNumber);
  } catch (error) {
    log.warn(`OneMap failed for ${dropNumber}`, { error });
  }

  // Fallback to BOSS API
  try {
    log.info(`Trying BOSS API for ${dropNumber}`);
    return await fetchFromBossApi(dropNumber);
  } catch (error) {
    log.warn(`BOSS API failed for ${dropNumber}`, { error });
  }

  // Last resort: local cache
  try {
    log.info(`Trying local cache for ${dropNumber}`);
    return await fetchFromLocalCache(dropNumber);
  } catch (error) {
    log.error(`All sources failed for ${dropNumber}`, { error });
    throw new Error(`All photo sources unavailable for ${dropNumber}`);
  }
}

/**
 * Fetch from specific source (for testing)
 */
async function fetchFromSpecificSource(
  dropNumber: string,
  source: 'onemap' | 'boss' | 'local'
): Promise<PhotoFetchResult> {
  switch (source) {
    case 'onemap':
      return await fetchFromOneMap(dropNumber);
    case 'boss':
      return await fetchFromBossApi(dropNumber);
    case 'local':
      return await fetchFromLocalCache(dropNumber);
    default:
      throw new Error(`Unknown source: ${source}`);
  }
}

/**
 * Fetch from OneMap GIS API (via port 8003)
 */
async function fetchFromOneMap(dropNumber: string): Promise<PhotoFetchResult> {
  try {
    const response = await fetch(`http://192.168.1.150:8003/api/photos/${dropNumber}`);

    if (!response.ok) {
      throw new Error(`OneMap API error: ${response.status}`);
    }

    const data = await response.json();

    // Map OneMap response to our Photo interface
    const photos: Photo[] = data.photos.map((photo: any) => ({
      filename: photo.filename,
      step: mapPhotoTypeToStep(photo.type),
      url: photo.url,
      size: photo.size,
      modified: photo.modified,
    }));

    return {
      source: 'onemap',
      photos,
      count: photos.length,
    };
  } catch (error) {
    log.error('OneMap fetch failed', { dropNumber, error });
    throw error;
  }
}

/**
 * Fetch from BOSS VPS API (port 8001)
 */
async function fetchFromBossApi(dropNumber: string): Promise<PhotoFetchResult> {
  try {
    const response = await fetch(`http://192.168.1.150:8001/api/photos/${dropNumber}`);

    if (!response.ok) {
      throw new Error(`BOSS API error: ${response.status}`);
    }

    const data = await response.json();

    // Map BOSS response to our Photo interface
    const photos: Photo[] = data.photos.map((photo: any) => ({
      filename: photo.filename,
      step: mapPhotoTypeToStep(photo.type),
      url: photo.url,
      size: photo.size,
      modified: photo.modified,
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
 * Map photo type to unified step number
 */
function mapPhotoTypeToStep(photoType: string): number {
  const mapping: Record<string, number> = {
    'ph_prop': 1, 'ph_sign1': 1,        // House Photo
    'ph_pole': 2, 'ph_cbl_r': 2,        // Cable from Pole
    'ph_entry_out': 3, 'ph_hm_ln': 3,   // Entry Outside
    'ph_entry_in': 4, 'ph_hm_en': 4,    // Entry Inside
    'ph_wall': 5,                        // Wall
    'ph_ont': 6, 'ph_ont_back': 6,      // ONT Back
    'ph_powm': 7, 'ph_powm2': 7,        // Power Meter
    'ph_bl': 8, 'ph_barcode': 8,        // ONT Barcode
    'ph_ups': 9,                         // UPS
    'ph_after': 10, 'ph_final': 10,     // Final
    'ph_lights': 11, 'ph_led': 11,      // Lights
  };

  return mapping[photoType] || 0;
}

/**
 * Update unified review with photo metadata
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
        updated_at = NOW()
      WHERE drop_number = $4;
      `,
      [result.source, result.count, JSON.stringify(result.photos), dropNumber]
    );

    log.info(`Updated review with photo metadata for ${dropNumber}`);
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
