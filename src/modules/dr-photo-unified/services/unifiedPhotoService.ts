/**
 * Unified Photo Service
 *
 * Purpose: Multi-source photo fetching with intelligent fallback (OneMap → BOSS → Local)
 * Status: PARTIAL - GREEN phase implementation (local cache not implemented)
 *
 * Following PAI principles:
 * - NO_CONSOLE_LOG: Uses log from @/lib/logger
 * - PROPER_ERROR_HANDLING: All errors logged with context
 * - TYPE_SAFETY: Full TypeScript coverage
 *
 * NLNH Confidence: MEDIUM
 * - OneMap integration tested
 * - BOSS API integration pending
 * - Local cache not implemented yet
 *
 * TODO:
 * - Implement BOSS API fallback (port 8001)
 * - Implement local filesystem cache
 * - Add retry logic with exponential backoff
 */

import { log } from '@/lib/logger';
import { fetchFromOneMap } from './oneMapIntegrationService';
import type { PhotoSourceResponse } from '../types/unified.types';

/**
 * Fetch photos with multi-source fallback
 *
 * Priority order:
 * 1. OneMap GIS API (port 8003) - Most authoritative
 * 2. BOSS VPS API (port 8001) - Backup/proxy
 * 3. Local filesystem cache - Offline resilience
 *
 * @param drNumber - DR number to fetch photos for (e.g., 'DR1730550')
 * @param options - Optional fetch options
 * @returns Photo source response with photos and metadata
 * @throws Error if all sources fail
 *
 * @example
 * // Fetch with automatic fallback
 * const result = await fetchPhotosWithFallback('DR1730550');
 * console.log(`Fetched ${result.count} photos from ${result.source}`);
 *
 * // Force specific source (for testing)
 * const result = await fetchPhotosWithFallback('DR1730550', { forceSource: 'boss' });
 */
export async function fetchPhotosWithFallback(
  drNumber: string,
  options?: {
    forceSource?: 'onemap' | 'boss' | 'local';
    timeout?: number;
  }
): Promise<PhotoSourceResponse> {
  log.info(`[UnifiedPhotoService] Fetching photos for ${drNumber}`, { options });

  // Try OneMap first (most reliable)
  try {
    log.info(`[UnifiedPhotoService] Trying OneMap (primary source) for ${drNumber}`);
    const result = await fetchFromOneMap(drNumber);
    log.info(`[UnifiedPhotoService] ✓ OneMap success for ${drNumber}`, {
      count: result.count,
    });
    return result;
  } catch (error) {
    log.warn(`[UnifiedPhotoService] ✗ OneMap failed for ${drNumber}, trying BOSS API`, {
      error,
    });
  }

  // PARTIAL: BOSS API fallback not implemented yet
  // TODO: Implement BOSS API integration (port 8001)
  log.warn(`[UnifiedPhotoService] BOSS API fallback not implemented yet for ${drNumber}`);

  // PARTIAL: Local cache fallback not implemented yet
  // TODO: Implement filesystem cache fallback
  log.warn(`[UnifiedPhotoService] Local cache fallback not implemented yet for ${drNumber}`);

  // All sources failed
  const errorMessage = `All photo sources unavailable for ${drNumber}`;
  log.error(`[UnifiedPhotoService] ${errorMessage}`);
  throw new Error(errorMessage);
}
