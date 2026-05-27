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

const logger = createLogger('drLookupService');

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

    // Query the current FibreFlow drops table first, with legacy onemap.drops
    // as fallback. New QField/OES drops (e.g. DR2598903) are stored in
    // public.drops and never appear in onemap.drops, which caused valid DRs to
    // be reported as missing in the NOC create-ticket form.
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
      municipality: string | null;
      cable_type: string | null;
      cable_length: string | null;
      ont_serial: string | null;
    }>(
      `WITH public_drop AS (
        SELECT
          d.drop_number AS dr_number,
          d.pole_number,
          d.project_id::text AS project_id,
          d.pon_no::text AS pon_code,
          d.zone_no::text AS zone_code,
          NULLIF(d.address, 'NULL') AS address,
          d.latitude::float AS latitude,
          d.longitude::float AS longitude,
          d.status AS current_status,
          COALESCE(p.project_name, d.site_submitted_project) AS project_name,
          p.project_code,
          d.municipality,
          d.cable_type,
          d.cable_length,
          d.ont_serial,
          1 AS source_priority
        FROM public.drops d
        LEFT JOIN public.projects p ON d.project_id = p.id
        WHERE UPPER(d.drop_number) = UPPER($1)
      ), legacy_onemap_drop AS (
        SELECT
          d.dr_number,
          d.pole_number,
          d.project_id::text AS project_id,
          d.pon_code,
          d.zone_code,
          NULLIF(d.address, 'NULL') AS address,
          d.latitude::float AS latitude,
          d.longitude::float AS longitude,
          d.current_status,
          p.project_name,
          p.project_code,
          NULL::text AS municipality,
          NULL::text AS cable_type,
          NULL::text AS cable_length,
          NULL::text AS ont_serial,
          2 AS source_priority
        FROM onemap.drops d
        LEFT JOIN onemap.projects p ON d.project_id = p.id
        WHERE UPPER(d.dr_number) = UPPER($1)
      )
      SELECT
        dr_number,
        pole_number,
        project_id,
        pon_code,
        zone_code,
        address,
        latitude,
        longitude,
        current_status,
        project_name,
        project_code,
        municipality,
        cable_type,
        cable_length,
        ont_serial
      FROM (
        SELECT * FROM public_drop
        UNION ALL
        SELECT * FROM legacy_onemap_drop
      ) drops
      ORDER BY source_priority
      LIMIT 1`,
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
      municipality: drData.municipality,
      cable_type: drData.cable_type,
      cable_length: drData.cable_length,
      status: drData.current_status,
      ont_serial: drData.ont_serial
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
