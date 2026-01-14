/**
 * OneMap Integration Service
 *
 * Purpose: Fetch photos from OneMap GIS API (port 8003) with step mapping
 * Status: WORKING - GREEN phase implementation
 *
 * Following PAI principles:
 * - NO_CONSOLE_LOG: Uses log from @/lib/logger
 * - PROPER_ERROR_HANDLING: All errors logged with context
 * - TYPE_SAFETY: Full TypeScript coverage
 *
 * NLNH Confidence: MEDIUM
 * - Integration with port 8003 tested locally
 * - Production endpoint may have different response structure
 * - Mark as PARTIAL until integration testing complete
 */

import { log } from '@/lib/logger';
import { photoTypeToStep } from '../utils/stepMapper';
import type { PhotoSourceResponse, Photo } from '../types/unified.types';

/**
 * OneMap API Configuration
 */
const ONEMAP_API_URL = 'http://192.168.1.150:8003';

/**
 * OneMap API Response (port 8003)
 *
 * PARTIAL: Structure based on existing port 8003 API
 * May need updates after integration testing
 */
interface OneMapAPIResponse {
  total_drs: number;
  drs: Array<{
    dr_number: string;
    project: string;
    photos: Array<{
      filename: string;
      modified: number;
    }>;
  }>;
}

/**
 * Extract photo type from filename
 *
 * Example filenames:
 * - DR1730550_ph_prop_001.jpg → 'ph_prop'
 * - DR1730550_ph_powm_001.jpg → 'ph_powm'
 * - DR1730550_ph_lights_001.jpg → 'ph_lights'
 *
 * @param filename - Photo filename from port 8003
 * @returns Photo type or null if invalid format
 */
function extractPhotoType(filename: string): string | null {
  // Pattern: DR{number}_{photo_type}_{sequence}.jpg
  const match = filename.match(/DR\d+_([a-z_]+)_\d+\.(jpg|jpeg|png)/i);
  return match ? match[1] : null;
}

/**
 * Fetch photos from OneMap GIS API (port 8003)
 *
 * This is the PRIMARY photo source (most authoritative).
 * Photos are fetched from the FastAPI service in Docker container dr-photo-api.
 *
 * @param drNumber - DR number to fetch photos for (e.g., 'DR1730550')
 * @returns Photo source response with mapped steps
 * @throws Error if fetch fails or API returns error
 *
 * @example
 * const result = await fetchFromOneMap('DR1730550');
 * // Returns: { source: 'onemap', count: 16, photos: [...] }
 */
export async function fetchFromOneMap(drNumber: string): Promise<PhotoSourceResponse> {
  log.info(`[OneMap] Fetching photos for ${drNumber}`);

  try {
    // Fetch from port 8003 API
    const response = await fetch(`${ONEMAP_API_URL}/api/photos`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OneMap API returned ${response.status}: ${response.statusText}`);
    }

    const data: OneMapAPIResponse = await response.json();

    // Find DR in response
    const drData = data.drs.find((dr) => dr.dr_number === drNumber);

    if (!drData) {
      log.warn(`[OneMap] DR ${drNumber} not found in response`);
      return {
        source: 'onemap',
        count: 0,
        photos: [],
      };
    }

    // Map photos with step numbers
    const photos: Photo[] = drData.photos.map((photo) => {
      const photoType = extractPhotoType(photo.filename);
      const step = photoType ? photoTypeToStep(photoType) : null;

      return {
        filename: photo.filename,
        step,
        url: `${ONEMAP_API_URL}/api/photo/${drNumber}/${photo.filename}`,
        modified: photo.modified,
      };
    });

    log.info(`[OneMap] Successfully fetched ${photos.length} photos for ${drNumber}`);

    return {
      source: 'onemap',
      count: photos.length,
      photos,
    };
  } catch (error) {
    log.error(`[OneMap] Failed to fetch photos for ${drNumber}`, { error });
    throw error;
  }
}
