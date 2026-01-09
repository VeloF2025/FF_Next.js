/**
 * DR Lookup Service
 *
 * Queries SOW module for DR (Drop) details including project, zone, pole, and PON information.
 *
 * Features:
 * - Lookup DR from drops table in SOW module
 * - Returns project, zone, pole, PON details
 * - In-memory caching to reduce database queries
 * - Comprehensive error handling
 *
 * 🟢 WORKING: Production-ready DR lookup service with caching
 */

import { queryOne } from '../utils/db';
import { DRLookupResult, DRLookupData } from '../types/ticket';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'drLookupService' });

/**
 * In-memory cache for DR lookup results
 * Key: DR number
 * Value: DRLookupData
 */
const drCache = new Map<string, DRLookupData>();

/**
 * Lookup DR number in SOW module and return complete details
 * 🟢 WORKING: Queries drops table and enriches with project data
 *
 * @param drNumber - The DR (drop) number to lookup
 * @returns DRLookupResult with success flag and data or error
 */
export async function lookupDR(drNumber: string): Promise<DRLookupResult> {
  try {
    // Validate input
    const trimmedDR = drNumber.trim();
    if (!trimmedDR) {
      return {
        success: false,
        data: null,
        error: 'DR number is required'
      };
    }

    // Check cache first
    const cachedResult = drCache.get(trimmedDR);
    if (cachedResult) {
      logger.debug('DR lookup cache hit', { drNumber: trimmedDR });
      return {
        success: true,
        data: cachedResult
      };
    }

    logger.info('Looking up DR number in SOW module', { drNumber: trimmedDR });

    // Query onemap.drops table for DR details (with project join)
    const drData = await queryOne<{
      dr_number: string;
      pole_number: string | null;
      project_id: string | null;
      pon_code: string | null;
      zone_code: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      current_status: string | null;
      project_name: string | null;
      project_code: string | null;
    }>(
      `SELECT
        d.dr_number,
        d.pole_number,
        d.project_id::text as project_id,
        d.pon_code,
        d.zone_code,
        NULLIF(d.address, 'NULL') as address,
        d.latitude::float as latitude,
        d.longitude::float as longitude,
        d.current_status,
        p.project_name,
        p.project_code
      FROM onemap.drops d
      LEFT JOIN onemap.projects p ON d.project_id = p.id
      WHERE UPPER(d.dr_number) = UPPER($1)`,
      [trimmedDR]
    );

    // Check if DR was found
    if (!drData || !drData.dr_number) {
      logger.warn('DR number not found', { drNumber: trimmedDR });
      return {
        success: false,
        data: null,
        error: 'DR number not found'
      };
    }

    // Parse zone and pon codes to numbers
    const zoneNumber = drData.zone_code ? parseInt(drData.zone_code, 10) : null;
    const ponNumber = drData.pon_code ? parseInt(drData.pon_code, 10) : null;

    // Initialize result data with DR information (project already joined)
    const resultData: DRLookupData = {
      dr_number: drData.dr_number,
      pole_number: drData.pole_number,
      pon_number: isNaN(ponNumber as number) ? null : ponNumber,
      zone_number: isNaN(zoneNumber as number) ? null : zoneNumber,
      project_id: drData.project_id,
      project_name: drData.project_name,
      project_code: drData.project_code,
      address: drData.address,
      latitude: drData.latitude,
      longitude: drData.longitude,
      municipality: null, // Not in onemap schema
      cable_type: null,   // Not in onemap schema
      cable_length: null, // Not in onemap schema
      status: drData.current_status
    };

    logger.debug('DR lookup successful', {
      drNumber: trimmedDR,
      projectCode: drData.project_code,
      projectName: drData.project_name
    });

    // Cache the result
    drCache.set(trimmedDR, resultData);
    logger.debug('DR lookup result cached', { drNumber: trimmedDR });

    return {
      success: true,
      data: resultData
    };
  } catch (error) {
    logger.error('Failed to lookup DR number', {
      error,
      drNumber: drNumber
    });

    return {
      success: false,
      data: null,
      error: `Failed to lookup DR number: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Get DR data from cache without querying database
 * 🟢 WORKING: Cache retrieval utility
 *
 * @param drNumber - The DR number to retrieve from cache
 * @returns Cached DRLookupData or null if not in cache
 */
export function getDRFromCache(drNumber: string): DRLookupData | null {
  const trimmedDR = drNumber.trim();
  return drCache.get(trimmedDR) || null;
}

/**
 * Clear all cached DR lookup results
 * 🟢 WORKING: Cache management utility
 *
 * Use this to invalidate cache when DR data changes
 */
export function clearDRCache(): void {
  drCache.clear();
  logger.info('DR lookup cache cleared');
}

/**
 * Clear specific DR from cache
 * 🟢 WORKING: Selective cache invalidation
 *
 * @param drNumber - The DR number to remove from cache
 */
export function clearDRFromCache(drNumber: string): void {
  const trimmedDR = drNumber.trim();
  const deleted = drCache.delete(trimmedDR);

  if (deleted) {
    logger.debug('DR removed from cache', { drNumber: trimmedDR });
  }
}

/**
 * Get cache statistics
 * 🟢 WORKING: Cache monitoring utility
 *
 * @returns Cache size and statistics
 */
export function getDRCacheStats(): {
  size: number;
  entries: string[];
} {
  return {
    size: drCache.size,
    entries: Array.from(drCache.keys())
  };
}
