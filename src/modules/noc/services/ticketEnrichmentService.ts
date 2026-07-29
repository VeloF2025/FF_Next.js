/**
 * Ticket Enrichment Service - Cross-reference data from FibreFlow
 *
 * 🟢 WORKING: Production-ready service for enriching ticket data
 *
 * Features:
 * - Look up GPS coordinates from DR number via sow_drops
 * - Look up customer info from onemap_properties
 * - Cross-reference with existing FibreFlow data
 *
 * @module maintenance/services/ticketEnrichmentService
 */

import { queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('maintenance:enrichment');

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
  /**
   * 1Map's own property identifier — `onemap_properties.property_id`, a
   * varchar, so this is a string at runtime.
   *
   * Deliberately NOT the same field the old `onemap_drops.property_id` held:
   * that was an integer FK into `onemap_properties.id`. Same name, different
   * meaning and different type. Nothing currently reads it; anything that
   * starts to must not assume the old semantics.
   */
  property_id: string | null;
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
 * Handles various formats: DR1853428, dr1853428, D1853428, 1853428
 *
 * The `D` is optional because the pattern used to require it (`/DR?(\d+)/`), so
 * the bare "1853428" fell through unchanged and could never equal a DR-prefixed
 * stored value — the docstring claimed the format was supported while the code
 * dropped it. Callers write `dr_number` unnormalised, so the form is reachable.
 *
 * Anchored deliberately: unanchored, this finds the digits inside
 * `DR-LAW-A-045` and rewrites it to `DR045`. Anything that is not a plain
 * optionally-prefixed number passes through untouched, as before.
 */
function normalizeDRNumber(drNumber: string): string {
  if (!drNumber) return '';

  // Remove leading/trailing whitespace
  const normalized = drNumber.trim().toUpperCase();

  // Extract the numeric portion, with or without a D/DR prefix
  const match = normalized.match(/^D?R?(\d+)$/);
  if (match) {
    return `DR${match[1]}`;
  }

  return normalized;
}

// ============================================================================
// Lookup Functions
// ============================================================================

const SOW_DROP_COLUMNS = `
        drop_number,
        pole_number,
        latitude,
        longitude,
        address,
        municipality,
        pon_no,
        zone_no,
        contractor,
        status`;

/**
 * Look up drop info from SOW data
 * 🟢 WORKING: Cross-references DR number with sow_drops table
 *
 * Both queries are equality tests. This used to fall back to
 * `drop_number LIKE '%<digits>%'` when the exact match missed, which returned
 * whichever unrelated drop the planner reached first.
 *
 * These rows supply the pole number, contractor, municipality, PON/zone and GPS
 * rendered on the ticket, so a collision points a technician at a stranger's
 * address. Returning nothing beats returning someone else.
 *
 * Measured against production, the substring form never once resolved a DR the
 * exact match had missed — every row it returned belonged to a different drop.
 * It could not do otherwise: a prefix-stripping fallback only helps when some
 * row is stored without the `DR` prefix, and no `sow_drops` row is.
 *
 * Figures are deliberately not quoted here. They live with the queries that
 * produce them, in `scripts/check-sow-drop-lookup-collisions.sql` (read-only,
 * ~40s) — run that rather than trusting a number in a comment.
 */
export async function lookupSOWDrop(drNumber: string): Promise<DropInfo | null> {
  if (!drNumber) return null;

  const normalized = normalizeDRNumber(drNumber);

  try {
    logger.debug('Looking up SOW drop', { drNumber: normalized });

    let result = await queryOne<DropInfo>(
      `SELECT ${SOW_DROP_COLUMNS}
      FROM sow_drops
      WHERE UPPER(drop_number) = $1
      LIMIT 1`,
      [normalized]
    );

    if (result) {
      logger.debug('SOW drop found', { drNumber: normalized });
      return result;
    }

    // Match with the DR prefix stripped from BOTH sides, for rows stored as
    // "1735912" rather than "DR1735912". Every sow_drops row is currently
    // DR-prefixed, so this adds nothing today — it is kept because the sibling
    // table onemap_properties holds thousands of bare rows (query 5 of the
    // script above), so an import source that stores them bare is a
    // demonstrated failure mode in this system rather than a hypothetical one.
    // Crucially it stays an equality test: reverting
    // it to LIKE is what caused the collisions described above.
    const numericPart = normalized.replace(/^DR/i, '');
    result = await queryOne<DropInfo>(
      `SELECT ${SOW_DROP_COLUMNS}
      FROM sow_drops
      WHERE REGEXP_REPLACE(UPPER(drop_number), '^DR', '') = $1
      LIMIT 1`,
      [numericPart]
    );

    logger.debug(result ? 'SOW drop found via prefix-insensitive match' : 'SOW drop not found', {
      drNumber: normalized,
    });

    return result;
  } catch (error) {
    logger.error('Error looking up SOW drop', { error, drNumber });
    return null;
  }
}

/**
 * Look up drop info from 1Map data
 * 🟢 WORKING: Cross-references DR number with the onemap_properties table.
 *
 * Reads `onemap_properties`, NOT `onemap_drops` — the latter holds 0 rows, so
 * this lookup used to return null for every ticket and no enrichment ever
 * reached the UI.
 *
 * `onemap_properties` stores roughly one row per workflow stage per drop, and
 * the contact number is captured at sign-up but not carried onto the
 * "Home Installation: Installed" row. Since tickets are raised against
 * installed drops, the ORDER BY below is what makes the difference between
 * finding a contact number and silently reporting none — do not reduce this to
 * a bare LIMIT 1.
 */
const ONEMAP_PROPERTY_COLUMNS = `
        drop_number,
        property_id,
        latitude,
        longitude,
        location_address AS address,
        NULLIF(TRIM(CONCAT_WS(' ', contact_name, contact_surname)), '') AS customer_name,
        contact_number,
        status`;

/**
 * Rows carrying a contact win.
 *
 * `last_modified_date` is kept as a secondary sort but does almost no work: of
 * the 6,840 drops that have more than one contact-bearing row, every one has it
 * NULL on all of them. `id DESC` is therefore the tie-break that actually
 * decides, favouring the most recently imported row.
 *
 * A deterministic tie-break is required, not cosmetic: some drops carry several
 * genuinely different numbers across import batches (DR1729512 has six
 * contact-bearing rows). Without a populated sort column the winner is chosen by
 * physical row order, which is stable only until the next VACUUM or replan — the
 * same ticket could show a different phone number after a routine maintenance
 * job. Picking the newest import is a rule; heap order is not.
 */
const ONEMAP_ROW_PREFERENCE = `
      ORDER BY (contact_number IS NOT NULL AND contact_number <> '') DESC,
               last_modified_date DESC NULLS LAST,
               id DESC`;

export async function lookupOneMapDrop(drNumber: string): Promise<OneMapDropInfo | null> {
  if (!drNumber) return null;

  const normalized = normalizeDRNumber(drNumber);

  try {
    logger.debug('Looking up 1Map drop', { drNumber: normalized });

    // Try exact match first
    let result = await queryOne<OneMapDropInfo>(
      `SELECT ${ONEMAP_PROPERTY_COLUMNS}
      FROM onemap_properties
      WHERE UPPER(drop_number) = $1
      ${ONEMAP_ROW_PREFERENCE}
      LIMIT 1`,
      [normalized]
    );

    if (result) {
      logger.debug('1Map drop found', { drNumber: normalized });
      return result;
    }

    // Fall back to matching with the DR prefix stripped from BOTH sides, for
    // rows stored as "1735912" rather than "DR1735912".
    //
    // This is an equality test, never a substring one. A `LIKE '%1729500%'`
    // here would match nine distinct drops (DR1729500…DR1729509) in the live
    // table, so a miss on the exact lookup could attach a different customer's
    // name, phone number and GPS to the ticket — strictly worse than returning
    // nothing.
    const numericPart = normalized.replace(/^DR/i, '');
    result = await queryOne<OneMapDropInfo>(
      `SELECT ${ONEMAP_PROPERTY_COLUMNS}
      FROM onemap_properties
      WHERE REGEXP_REPLACE(UPPER(drop_number), '^DR', '') = $1
      ${ONEMAP_ROW_PREFERENCE}
      LIMIT 1`,
      [numericPart]
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
    const projectCode = match[1]!.toUpperCase();
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
