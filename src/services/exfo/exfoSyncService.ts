/**
 * EXFO Exchange Sync Service
 *
 * Orchestrates syncing test results from EXFO Exchange into Neon.
 * Handles:
 * - Incremental sync (based on serverUpdatedDate cursor)
 * - Test name parsing (extracts project, pole, cabinet, port, link, fiber)
 * - Equipment matching (serial numbers → FibreFlow assets)
 * - Measurement detail enrichment
 */

import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { fetchAllResults, getMeasurementDetails } from './exfoApiService';
import type {
  ExfoSearchResult,
  ExfoMeasurementDetail,
  ExfoParsedName,
  ExfoSyncResult,
  ExfoSyncConfig,
} from './types';

const logger = createLogger('exfoSync');
const sql = neon(process.env.DATABASE_URL!);

// =============================================================================
// Name Parser
// =============================================================================

/**
 * Parse EXFO test name into structured components.
 * Convention: {PROJECT}.STS.{N}.DIS.DM.P.{POLE}-C{CAB}P{PORT}.L{LINK}-L{FIBER}
 *
 * Examples:
 *   MOA.STS.1.DIS.DM.P.B756-C5P5.L14-L1
 *   GRA.STS.2.DIS.DM.P.A123-C2P3.L7-L4
 */
export function parseTestName(name: string): ExfoParsedName {
  const result: ExfoParsedName = {
    project: null,
    section: null,
    sectionNum: null,
    pole: null,
    cabinet: null,
    port: null,
    link: null,
    fiber: null,
  };

  if (!name) return result;

  // Split on dots first: MOA.STS.1.DIS.DM.P.B756-C5P5.L14-L1
  const parts = name.split('.');

  if (parts.length >= 1) result.project = parts[0] || null;
  if (parts.length >= 2) result.section = parts[1] || null;
  if (parts.length >= 3) {
    const num = parseInt(parts[2] || '', 10);
    result.sectionNum = isNaN(num) ? null : num;
  }

  // Find the pole-cabinet segment (contains hyphen like P.B756-C5P5)
  const fullName = name;

  // Match pole: P.{POLE} or just the pole reference
  const poleMatch = fullName.match(/\.P\.([A-Z]\d+)/i);
  if (poleMatch?.[1]) result.pole = poleMatch[1];

  // Match cabinet and port: -C{N}P{N}
  const cabPortMatch = fullName.match(/-C(\d+)P(\d+)/i);
  if (cabPortMatch?.[1] && cabPortMatch[2]) {
    result.cabinet = `C${cabPortMatch[1]}`;
    result.port = `P${cabPortMatch[2]}`;
  }

  // Match link and fiber: .L{N}-L{N}
  const linkFiberMatch = fullName.match(/\.L(\d+)-L(\d+)/i);
  if (linkFiberMatch?.[1] && linkFiberMatch[2]) {
    result.link = `L${linkFiberMatch[1]}`;
    result.fiber = `L${linkFiberMatch[2]}`;
  }

  return result;
}

// =============================================================================
// Equipment Matching
// =============================================================================

/**
 * Match equipment serial numbers to FibreFlow assets.
 * Returns asset IDs if found.
 */
async function matchAssets(
  serialA: string | null,
  serialB: string | null
): Promise<{ assetIdA: string | null; assetIdB: string | null }> {
  let assetIdA: string | null = null;
  let assetIdB: string | null = null;

  if (serialA) {
    const rows = await sql`
      SELECT id FROM assets
      WHERE serial_number = ${serialA}
      LIMIT 1
    `;
    if (rows.length > 0) assetIdA = rows[0]!.id as string;
  }

  if (serialB) {
    const rows = await sql`
      SELECT id FROM assets
      WHERE serial_number = ${serialB}
      LIMIT 1
    `;
    if (rows.length > 0) assetIdB = rows[0]!.id as string;
  }

  return { assetIdA, assetIdB };
}

/**
 * Match parsed project code to a FibreFlow project.
 */
async function matchProject(projectCode: string | null): Promise<string | null> {
  if (!projectCode) return null;

  // Try exact match on project_code first
  const rows = await sql`
    SELECT id FROM projects
    WHERE UPPER(project_code) = UPPER(${projectCode})
    LIMIT 1
  `;

  if (rows.length > 0) return rows[0]!.id as string;

  // Try partial match on project_name
  const likePattern = `%${projectCode}%`;
  const nameRows = await sql`
    SELECT id FROM projects
    WHERE UPPER(project_name) LIKE UPPER(${likePattern})
    LIMIT 1
  `;

  return nameRows.length > 0 ? (nameRows[0]!.id as string) : null;
}

// =============================================================================
// Detail Extraction
// =============================================================================

/**
 * Extract structured fields from EXFO measurement detail response.
 */
function extractDetailFields(detail: ExfoMeasurementDetail): Record<string, unknown> {
  const brief = detail.brief || {};
  const hardware = brief.Hardware || {};
  const identification = brief.Identification || {};
  const fiberInfo = brief.FiberInformation || {};
  const identifiers = brief.Identifiers || [];
  const metadata = detail.metadata || {};

  // Parse identifiers array
  const getIdentifier = (name: string): string | null => {
    const entry = identifiers.find(
      (i) => i.Name?.toLowerCase() === name.toLowerCase()
    );
    return entry?.Value || null;
  };

  return {
    unit_a_serial: hardware.UnitA?.SerialNumber || null,
    unit_a_model: hardware.UnitA?.ModelName || null,
    unit_a_calibration: hardware.UnitA?.LastCalibrationDate || null,
    unit_b_serial: hardware.UnitB?.SerialNumber || null,
    unit_b_model: hardware.UnitB?.ModelName || null,
    unit_b_calibration: hardware.UnitB?.LastCalibrationDate || null,
    platform_serial: metadata.platformSerialNumber || null,
    platform_model: metadata.platformUsed || null,
    company_name: identification.CompanyName || null,
    customer_name: identification.CustomerName || null,
    operator_a: identification.OperatorA || null,
    operator_b: identification.OperatorB || null,
    fiber_type: fiberInfo.FiberType || null,
    location_direction: fiberInfo.LocationDirection || null,
    cable_id: getIdentifier('Cable ID'),
    fiber_id: getIdentifier('Fiber ID'),
    location_a: getIdentifier('Location A'),
    location_b: getIdentifier('Location B'),
    geolocation: identification.Geolocation || null,
  };
}

// =============================================================================
// Sync Orchestration
// =============================================================================

/**
 * Get all active sync configs from the database.
 */
export async function getSyncConfigs(): Promise<ExfoSyncConfig[]> {
  const rows = await sql`
    SELECT * FROM exfo_sync_config
    WHERE is_active = true
    ORDER BY workspace_name
  `;
  return rows as unknown as ExfoSyncConfig[];
}

/**
 * Run sync for a single workspace.
 * Supports incremental (from cursor) and full sync modes.
 */
export async function syncWorkspace(
  config: ExfoSyncConfig,
  options: { full?: boolean; fetchDetails?: boolean; maxResults?: number } = {}
): Promise<ExfoSyncResult> {
  const { workspace_id, workspace_name } = config;
  const fetchDetails = options.fetchDetails !== false; // default true
  const maxResults = options.maxResults || 5000;

  logger.info('Starting EXFO sync', { workspace_id, workspace_name, full: !!options.full });

  // Create sync history record
  const historyRows = await sql`
    INSERT INTO exfo_sync_history (workspace_id, sync_type, status)
    VALUES (${workspace_id}, ${options.full ? 'full' : 'incremental'}, 'running')
    RETURNING id
  `;
  const syncBatchId = historyRows[0]!.id as string;

  const result: ExfoSyncResult = {
    status: 'completed',
    resultsFetched: 0,
    resultsInserted: 0,
    resultsUpdated: 0,
    detailsFetched: 0,
    assetsMatched: 0,
  };

  try {
    // Determine sync cursor
    const updatedSince = options.full ? undefined : (config.last_sync_cursor || undefined);

    // Fetch all search results
    const searchResults = await fetchAllResults(workspace_id, {
      updatedSince,
      maxResults,
    });
    result.resultsFetched = searchResults.length;

    if (searchResults.length === 0) {
      logger.info('No new results to sync', { workspace_id });
      await completeSyncHistory(syncBatchId, result);
      return result;
    }

    // Determine which results need detail fetching (new or updated)
    const resultIds = searchResults.map(r => r.resultId);
    const existingRows = await sql`
      SELECT exfo_result_id FROM exfo_test_results
      WHERE exfo_result_id = ANY(${resultIds})
    `;
    const existingIds = new Set(existingRows.map(r => r.exfo_result_id as string));

    // Fetch measurement details for new/updated results
    let details = new Map<string, ExfoMeasurementDetail>();
    if (fetchDetails) {
      const idsToFetch = resultIds.filter(id => !existingIds.has(id));
      if (idsToFetch.length > 0) {
        details = await getMeasurementDetails(workspace_id, idsToFetch, {
          delayMs: 150,
          onProgress: (done, total) => {
            if (done % 10 === 0 || done === total) {
              logger.info('Detail fetch progress', { done, total, workspace_id });
            }
          },
        });
        result.detailsFetched = details.size;
      }
    }

    // Upsert results
    for (const searchResult of searchResults) {
      const isNew = !existingIds.has(searchResult.resultId);
      const detail = details.get(searchResult.resultId);
      const parsed = parseTestName(searchResult.name);

      // Extract detail fields
      const detailFields = detail ? extractDetailFields(detail) : {};

      // Match assets by serial number
      const { assetIdA, assetIdB } = await matchAssets(
        detailFields.unit_a_serial as string | null,
        detailFields.unit_b_serial as string | null
      );
      if (assetIdA || assetIdB) result.assetsMatched++;

      // Match project
      const projectId = config.project_id || await matchProject(parsed.project);

      await upsertResult(searchResult, parsed, detailFields, detail, {
        workspaceId: workspace_id,
        syncBatchId,
        projectId,
        assetIdA,
        assetIdB,
      });

      if (isNew) {
        result.resultsInserted++;
      } else {
        result.resultsUpdated++;
      }
    }

    // Update sync cursor to latest serverUpdatedDate
    const latestDate = searchResults
      .map(r => r.serverUpdatedDate)
      .filter(Boolean)
      .sort()
      .pop();

    if (latestDate) {
      await sql`
        UPDATE exfo_sync_config
        SET last_sync_at = NOW(),
            last_sync_cursor = ${latestDate},
            updated_at = NOW()
        WHERE workspace_id = ${workspace_id}
      `;
    }

    await completeSyncHistory(syncBatchId, result);
    logger.info('EXFO sync completed', { workspace_id, ...result });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.status = 'failed';
    result.error = errorMsg;

    await sql`
      UPDATE exfo_sync_history
      SET status = 'failed', error_message = ${errorMsg}, completed_at = NOW()
      WHERE id = ${syncBatchId}::UUID
    `;

    logger.error('EXFO sync failed', { workspace_id, error: errorMsg });
  }

  return result;
}

/**
 * Sync all active workspaces.
 */
export async function syncAllWorkspaces(
  options: { full?: boolean; fetchDetails?: boolean } = {}
): Promise<Record<string, ExfoSyncResult>> {
  const configs = await getSyncConfigs();
  const results: Record<string, ExfoSyncResult> = {};

  for (const config of configs) {
    results[config.workspace_id] = await syncWorkspace(config, options);
  }

  return results;
}

// =============================================================================
// Database Operations
// =============================================================================

async function upsertResult(
  search: ExfoSearchResult,
  parsed: ExfoParsedName,
  detailFields: Record<string, unknown>,
  rawDetail: ExfoMeasurementDetail | undefined,
  meta: {
    workspaceId: string;
    syncBatchId: string;
    projectId: string | null;
    assetIdA: string | null;
    assetIdB: string | null;
  }
): Promise<void> {
  // Normalize verdict: EXFO returns lowercase "pass"/"fail", we store capitalized
  const verdict = search.globalVerdict
    ? search.globalVerdict.charAt(0).toUpperCase() + search.globalVerdict.slice(1).toLowerCase()
    : null;
  const testDateTime = search.testDateTime ? new Date(search.testDateTime).toISOString() : null;
  const serverUpdated = search.serverUpdatedDate ? new Date(search.serverUpdatedDate).toISOString() : null;
  const unitACal = detailFields.unit_a_calibration ? String(detailFields.unit_a_calibration) : null;
  const unitBCal = detailFields.unit_b_calibration ? String(detailFields.unit_b_calibration) : null;
  const geoJson = detailFields.geolocation ? JSON.stringify(detailFields.geolocation) : null;
  const rawSearchJson = JSON.stringify(search);
  const rawMeasurementJson = rawDetail ? JSON.stringify(rawDetail) : null;

  await sql`
    INSERT INTO exfo_test_results (
      exfo_result_id, exfo_account_id, exfo_workspace_id, exfo_job_id, exfo_brief_job_id,
      test_type, test_name, job_name, config_name, global_verdict,
      test_date_time, server_updated_date,
      parsed_project, parsed_section, parsed_section_num,
      parsed_pole, parsed_cabinet, parsed_port, parsed_link, parsed_fiber,
      unit_a_serial, unit_a_model, unit_a_calibration,
      unit_b_serial, unit_b_model, unit_b_calibration,
      platform_serial, platform_model,
      company_name, customer_name, operator_a, operator_b,
      test_point_name, fiber_type, location_direction,
      cable_id, fiber_id, location_a, location_b,
      geolocation, created_by_uuid, updated_by_uuid,
      attachments_count, project_id, asset_id, asset_id_b,
      sync_batch_id, raw_search_data, raw_measurement_data
    ) VALUES (
      ${search.resultId}, ${search.accountId}, ${meta.workspaceId},
      ${search.jobId}, ${search.briefJobId},
      ${search.type}, ${search.name}, ${search.jobName}, ${search.configName},
      ${verdict},
      ${testDateTime}::TIMESTAMPTZ, ${serverUpdated}::TIMESTAMPTZ,
      ${parsed.project}, ${parsed.section}, ${parsed.sectionNum},
      ${parsed.pole}, ${parsed.cabinet}, ${parsed.port}, ${parsed.link}, ${parsed.fiber},
      ${detailFields.unit_a_serial as string | null}, ${detailFields.unit_a_model as string | null},
      ${unitACal}::DATE,
      ${detailFields.unit_b_serial as string | null}, ${detailFields.unit_b_model as string | null},
      ${unitBCal}::DATE,
      ${detailFields.platform_serial as string | null}, ${detailFields.platform_model as string | null},
      ${detailFields.company_name as string | null}, ${detailFields.customer_name as string | null},
      ${detailFields.operator_a as string | null}, ${detailFields.operator_b as string | null},
      ${search.testPointName}, ${detailFields.fiber_type as string | null},
      ${detailFields.location_direction as string | null},
      ${detailFields.cable_id as string | null}, ${detailFields.fiber_id as string | null},
      ${detailFields.location_a as string | null}, ${detailFields.location_b as string | null},
      ${geoJson}::JSONB, ${search.createdBy}, ${search.updatedBy},
      ${search.attachmentsCount},
      ${meta.projectId}::UUID, ${meta.assetIdA}::UUID, ${meta.assetIdB}::UUID,
      ${meta.syncBatchId}::UUID,
      ${rawSearchJson}::JSONB, ${rawMeasurementJson}::JSONB
    )
    ON CONFLICT (exfo_result_id) DO UPDATE SET
      global_verdict = EXCLUDED.global_verdict,
      server_updated_date = EXCLUDED.server_updated_date,
      updated_by_uuid = EXCLUDED.updated_by_uuid,
      attachments_count = EXCLUDED.attachments_count,
      raw_search_data = EXCLUDED.raw_search_data,
      sync_batch_id = EXCLUDED.sync_batch_id,
      updated_at = NOW()
  `;
}

async function completeSyncHistory(
  syncBatchId: string,
  result: ExfoSyncResult
): Promise<void> {
  await sql`
    UPDATE exfo_sync_history
    SET status = 'completed',
        results_fetched = ${result.resultsFetched},
        results_inserted = ${result.resultsInserted},
        results_updated = ${result.resultsUpdated},
        details_fetched = ${result.detailsFetched},
        assets_matched = ${result.assetsMatched},
        completed_at = NOW()
    WHERE id = ${syncBatchId}::UUID
  `;
}
