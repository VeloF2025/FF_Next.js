/**
 * Ticket Enrichment Service - Cross-reference data from FibreFlow
 *
 * 🟢 WORKING: Production-ready service for enriching ticket data
 *
 * Features:
 * - Look up GPS coordinates from DR number via sow_drops
 * - Look up customer info from onemap_drops
 * - Cross-reference with existing FibreFlow data
 *
 * @module ticketing/services/ticketEnrichmentService
 */

import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ticketing:enrichment');

// ============================================================================
// Types
// ============================================================================

/**
 * GPS coordinates from FibreFlow drops
 */
export interface GPSData {
  latitude: number;
  longitude: number;
  address: string | null;
}

/**
 * Drop info from SOW data
 */
export interface DropInfo {
  drop_number: string;
  pole_number: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  municipality: string | null;
  pon_no: number | null;
  zone_no: number | null;
  contractor: string | null;
  status: string | null;
}

/**
 * 1Map drop info
 */
export interface OneMapDropInfo {
  drop_number: string;
  property_id: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  customer_name: string | null;
  contact_number: string | null;
  status: string | null;
}

/**
 * Project info from lookup
 */
export interface ProjectInfo {
  project_id: string;
  project_name: string;
  project_code: string | null;
}

/**
 * Enriched ticket data with cross-references
 */
export interface EnrichedTicketData {
  // From FibreFlow drops (DR lookup)
  fibreflow_gps: GPSData | null;
  fibreflow_pole_number: string | null;
  fibreflow_pon: number | null;
  fibreflow_zone: number | null;
  fibreflow_contractor: string | null;
  fibreflow_municipality: string | null;

  // From 1Map
  onemap_customer_name: string | null;
  onemap_contact_number: string | null;
  onemap_address: string | null;
  onemap_gps: GPSData | null;

  // Project info (from DR number lookup or pattern matching)
  project: ProjectInfo | null;

  // Cross-reference success flags
  sow_match_found: boolean;
  onemap_match_found: boolean;
  project_match_found: boolean;
}

// ============================================================================
// DR Number Normalization
// ============================================================================

/**
 * Normalize DR number for lookup
 * Handles various formats: DR1853428, dr1853428, 1853428
 */
function normalizeDRNumber(drNumber: string): string {
  if (!drNumber) return '';

  // Remove leading/trailing whitespace
  let normalized = drNumber.trim().toUpperCase();

  // Extract numeric portion if prefixed with DR
  const match = normalized.match(/DR?(\d+)/i);
  if (match) {
    return `DR${match[1]}`;
  }

  return normalized;
}

// ============================================================================
// Lookup Functions
// ============================================================================

/**
 * Look up drop info from SOW data
 * 🟢 WORKING: Cross-references DR number with sow_drops table
 */
export async function lookupSOWDrop(drNumber: string): Promise<DropInfo | null> {
  if (!drNumber) return null;

  const normalized = normalizeDRNumber(drNumber);

  try {
    logger.debug('Looking up SOW drop', { drNumber: normalized });

    // Try exact match first
    let result = await queryOne<DropInfo>(
      `SELECT
        drop_number,
        pole_number,
        latitude,
        longitude,
        address,
        municipality,
        pon_no,
        zone_no,
        contractor,
        status
      FROM sow_drops
      WHERE UPPER(drop_number) = $1
      LIMIT 1`,
      [normalized]
    );

    if (result) {
      logger.debug('SOW drop found', { drNumber: normalized });
      return result;
    }

    // Try without DR prefix
    const numericPart = normalized.replace(/^DR/i, '');
    result = await queryOne<DropInfo>(
      `SELECT
        drop_number,
        pole_number,
        latitude,
        longitude,
        address,
        municipality,
        pon_no,
        zone_no,
        contractor,
        status
      FROM sow_drops
      WHERE drop_number LIKE $1
      LIMIT 1`,
      [`%${numericPart}%`]
    );

    if (result) {
      logger.debug('SOW drop found via fuzzy match', { drNumber: normalized });
    }

    return result;
  } catch (error) {
    logger.error('Error looking up SOW drop', { error, drNumber });
    return null;
  }
}

/**
 * Look up drop info from 1Map data
 * 🟢 WORKING: Cross-references DR number with onemap_drops table
 */
export async function lookupOneMapDrop(drNumber: string): Promise<OneMapDropInfo | null> {
  if (!drNumber) return null;

  const normalized = normalizeDRNumber(drNumber);

  try {
    logger.debug('Looking up 1Map drop', { drNumber: normalized });

    // Try exact match first
    let result = await queryOne<OneMapDropInfo>(
      `SELECT
        drop_number,
        property_id,
        latitude,
        longitude,
        address,
        customer_name,
        contact_number,
        status
      FROM onemap_drops
      WHERE UPPER(drop_number) = $1
      LIMIT 1`,
      [normalized]
    );

    if (result) {
      logger.debug('1Map drop found', { drNumber: normalized });
      return result;
    }

    // Try without DR prefix
    const numericPart = normalized.replace(/^DR/i, '');
    result = await queryOne<OneMapDropInfo>(
      `SELECT
        drop_number,
        property_id,
        latitude,
        longitude,
        address,
        customer_name,
        contact_number,
        status
      FROM onemap_drops
      WHERE drop_number LIKE $1
      LIMIT 1`,
      [`%${numericPart}%`]
    );

    if (result) {
      logger.debug('1Map drop found via fuzzy match', { drNumber: normalized });
    }

    return result;
  } catch (error) {
    logger.error('Error looking up 1Map drop', { error, drNumber });
    return null;
  }
}

/**
 * DR number prefix to project mapping
 * Maps short codes in DR numbers (e.g., DR-LAW-A-045) to project names
 */
const DR_PREFIX_PROJECT_MAP: Record<string, string> = {
  'LAW': 'Lawley',
  'MAM': 'Mamelodi',
  'MOH': 'Mohadin',
  'VELO': 'Velo Test',
};

/**
 * Parse DR number pattern to extract project code
 * Supports formats: DR-LAW-A-045, DR-MAM-C-078, etc.
 */
function parseProjectFromDRPattern(drNumber: string): string | null {
  if (!drNumber) return null;

  // Pattern: DR-{PROJECT}-{ZONE}-{NUMBER}
  const match = drNumber.match(/^DR-([A-Z]+)-/i);
  if (match) {
    const projectCode = match[1].toUpperCase();
    return DR_PREFIX_PROJECT_MAP[projectCode] || null;
  }

  return null;
}

/**
 * Look up project info from DR number
 * 🟢 WORKING: Cross-references DR number with drops/sow_drops tables or parses pattern
 *
 * Strategy:
 * 1. Try to find project_id from sow_drops table
 * 2. Try to find project_id from drops table
 * 3. Fall back to parsing DR number pattern (DR-LAW-*, DR-MAM-*, etc.)
 */
export async function lookupProjectFromDR(drNumber: string): Promise<ProjectInfo | null> {
  if (!drNumber) return null;

  const normalized = normalizeDRNumber(drNumber);

  try {
    logger.debug('Looking up project from DR', { drNumber: normalized });

    // Strategy 1: Check sow_drops table for project_id
    const sowResult = await queryOne<{ project_id: string }>(
      `SELECT project_id FROM sow_drops
       WHERE UPPER(drop_number) = $1 AND project_id IS NOT NULL
       LIMIT 1`,
      [normalized]
    );

    if (sowResult?.project_id) {
      const project = await queryOne<ProjectInfo>(
        `SELECT id as project_id, project_name, project_code
         FROM projects WHERE id = $1`,
        [sowResult.project_id]
      );
      if (project) {
        logger.debug('Project found via sow_drops', { drNumber: normalized, project: project.project_name });
        return project;
      }
    }

    // Strategy 2: Check drops table for project_id
    const dropsResult = await queryOne<{ project_id: string }>(
      `SELECT project_id FROM drops
       WHERE UPPER(drop_number) = $1 AND project_id IS NOT NULL
       LIMIT 1`,
      [normalized]
    );

    if (dropsResult?.project_id) {
      const project = await queryOne<ProjectInfo>(
        `SELECT id as project_id, project_name, project_code
         FROM projects WHERE id = $1`,
        [dropsResult.project_id]
      );
      if (project) {
        logger.debug('Project found via drops', { drNumber: normalized, project: project.project_name });
        return project;
      }
    }

    // Strategy 3: Parse DR number pattern (e.g., DR-LAW-A-045 → Lawley)
    const projectNameFromPattern = parseProjectFromDRPattern(drNumber);
    if (projectNameFromPattern) {
      // Look up project by name
      const project = await queryOne<ProjectInfo>(
        `SELECT id as project_id, project_name, project_code
         FROM projects WHERE LOWER(project_name) = LOWER($1)`,
        [projectNameFromPattern]
      );
      if (project) {
        logger.debug('Project found via DR pattern', { drNumber, project: project.project_name });
        return project;
      }
    }

    logger.debug('No project found for DR number', { drNumber });
    return null;
  } catch (error) {
    logger.error('Error looking up project from DR', { error, drNumber });
    return null;
  }
}

/**
 * Enrich ticket data with cross-references from FibreFlow
 * 🟢 WORKING: Main enrichment function
 *
 * @param drNumber - DR number to look up
 * @returns Enriched data from FibreFlow sources
 */
export async function enrichTicketData(drNumber: string | null): Promise<EnrichedTicketData> {
  const result: EnrichedTicketData = {
    fibreflow_gps: null,
    fibreflow_pole_number: null,
    fibreflow_pon: null,
    fibreflow_zone: null,
    fibreflow_contractor: null,
    fibreflow_municipality: null,
    onemap_customer_name: null,
    onemap_contact_number: null,
    onemap_address: null,
    onemap_gps: null,
    project: null,
    sow_match_found: false,
    onemap_match_found: false,
    project_match_found: false,
  };

  if (!drNumber) {
    return result;
  }

  try {
    // Look up in all sources in parallel
    const [sowDrop, oneMapDrop, projectInfo] = await Promise.all([
      lookupSOWDrop(drNumber),
      lookupOneMapDrop(drNumber),
      lookupProjectFromDR(drNumber),
    ]);

    // Populate from SOW data
    if (sowDrop) {
      result.sow_match_found = true;
      result.fibreflow_pole_number = sowDrop.pole_number;
      result.fibreflow_pon = sowDrop.pon_no;
      result.fibreflow_zone = sowDrop.zone_no;
      result.fibreflow_contractor = sowDrop.contractor;
      result.fibreflow_municipality = sowDrop.municipality;

      if (sowDrop.latitude && sowDrop.longitude) {
        result.fibreflow_gps = {
          latitude: Number(sowDrop.latitude),
          longitude: Number(sowDrop.longitude),
          address: sowDrop.address,
        };
      }
    }

    // Populate from 1Map data
    if (oneMapDrop) {
      result.onemap_match_found = true;
      result.onemap_customer_name = oneMapDrop.customer_name;
      result.onemap_contact_number = oneMapDrop.contact_number;
      result.onemap_address = oneMapDrop.address;

      if (oneMapDrop.latitude && oneMapDrop.longitude) {
        result.onemap_gps = {
          latitude: Number(oneMapDrop.latitude),
          longitude: Number(oneMapDrop.longitude),
          address: oneMapDrop.address,
        };
      }
    }

    // Populate project info
    if (projectInfo) {
      result.project_match_found = true;
      result.project = projectInfo;
    }

    logger.debug('Ticket enrichment complete', {
      drNumber,
      sowMatch: result.sow_match_found,
      oneMapMatch: result.onemap_match_found,
      projectMatch: result.project_match_found,
      projectName: result.project?.project_name,
    });

    return result;
  } catch (error) {
    logger.error('Error enriching ticket data', { error, drNumber });
    return result;
  }
}
