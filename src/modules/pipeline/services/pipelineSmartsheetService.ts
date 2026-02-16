/**
 * Pipeline Smartsheet Service
 * Syncs data between Smartsheet (Velocity_Master_Tracker) and Neon database
 */

import { sql } from '@/lib/neon';
import type {
  SmartsheetSyncConfig,
  SmartsheetSyncHistory,
  SyncResult,
  SyncError,
  SyncWarning,
  SyncTrigger,
  SyncHistoryStatus,
  SmartsheetSheet,
  SmartsheetRow,
  SmartsheetColumn,
  CreateSyncConfigInput,
  UpdateSyncConfigInput,
  ColumnMappings,
  StatusMappings,
} from '../types/smartsheet.types';

// ============================================================================
// Constants
// ============================================================================

const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0';

// Column IDs for Velocity_Master_Tracker (from API inspection)
const VELOCITY_TRACKER_COLUMNS = {
  PROJECT_NAME: 339507666440068,
  REGION: 4843107293810564,
  AREA: 2591307480125316,
  ESTIMATE_COUNT: 7094907107495812,
  PO_COUNT: 1465407573282692,
  PO_STATUS: 7657857060917124,
  CUSTOMER: 5969007200653188,
  WAYLEAVE_APPLICATION_DATE: 8922719130963844,
  WAYLEAVE_STATUS: 3717207386967940,
  WAYLEAVE_EXPIRATION_DATE: 902457619861380,
  WAYLEAVE_DOCS_UPLOADED: 1624427233759108,
  NETWORK_METHOD: 5406057247231876,
  COMPLETION: 3154257433546628,
  WAYLEAVE_APPLICANT: 2028357526704004,
  NEAREST_BH: 6531957154074500,
  MH_NAME: 4280157340389252,
  MH_COORDS: 8783756967759748,
  STAKEHOLDER_RECEIVED: 4155114088255364,
  STAKEHOLDER_OUTSTANDING: 8658713715625860,
  WAYLEAVE_COMMENTS: 126626108755844,
  COMMENT_OTHER: 198770178084740,
  // New columns added Jan 2026
  WAYLEAVE_START: 3272064541347716,
  WAYLEAVE_END: 7775664168718212,
  CESSION_DATE: 2146164634505092,
  CESSION_SIGNED: 6649764261875588,
};

// Status mapping: Smartsheet → Pipeline
const WAYLEAVE_STATUS_MAP: Record<string, string> = {
  'Complete': 'approved',
  'In Progress': 'submitted',
  'Partially Complete': 'conditionally_approved',
  'Expired': 'expired',
  'On Hold': 'on_hold',
  'Cancelled': 'withdrawn',
  'Trying to locate WL approval from applicant': 'pending_info',
};

// PO Status mapping
const PO_STATUS_MAP: Record<string, string> = {
  'Received': 'ready_to_plan',
  'Quote Sent': 'po_pending',
  'Pending count': 'approvals_in_progress',
  'Cancelled': 'cancelled',
};

// Stakeholder name → approval type code mapping
const STAKEHOLDER_TO_CODE: Record<string, string> = {
  // Existing types
  'eskom': 'wayleave_eskom',
  'telkom': 'wayleave_telkom',
  'sanral': 'wayleave_sanral',
  'transnet': 'wayleave_transnet',
  'prasa': 'wayleave_prasa',
  // New telecom types
  'cell c': 'wayleave_cell_c',
  'dfa': 'wayleave_dfa',
  'frogfoot': 'wayleave_frogfoot',
  'ict': 'wayleave_ict',
  'link africa': 'wayleave_link_africa',
  'liquid': 'wayleave_liquid',
  'metro fibre': 'wayleave_metro_fibre',
  'mtc': 'wayleave_mtc',
  'mtn': 'wayleave_mtn',
  'open serve': 'wayleave_open_serve',
  'seacom': 'wayleave_seacom',
  'vodacom': 'wayleave_vodacom',
  'vumatel': 'wayleave_vumatel',
  // Utilities
  'city power': 'wayleave_city_power',
  'city parks': 'wayleave_city_parks',
  'egoli gas': 'wayleave_egoli_gas',
  'rand water': 'wayleave_rand_water',
  'sasol': 'wayleave_sasol',
  'air products': 'wayleave_air_products',
  // Municipal
  'jra': 'municipal_jra',
  'ekurhuleni roads': 'municipal_ekurhuleni_roads',
  'ekurhuleni electricity': 'municipal_ekurhuleni_electricity',
  'ekurhuleni water': 'municipal_ekurhuleni_water',
  'ekurhuleni water & sewer': 'municipal_ekurhuleni_water',
  'cot electricity': 'municipal_cot_electricity',
  'cot water': 'municipal_cot_water',
  'cot water & sanitation': 'municipal_cot_water',
  'cot stormwater': 'municipal_cot_stormwater',
  'cot urban forestry': 'municipal_cot_forestry',
  'jhb water': 'municipal_jhb_water',
  'johannesburg water': 'municipal_jhb_water',
  'buffalo city': 'municipal_buffalo_city',
};

// ============================================================================
// Smartsheet API Functions
// ============================================================================

async function getApiToken(): Promise<string> {
  const token = process.env.SMARTSHEET_API_TOKEN;
  if (!token) {
    throw new Error('SMARTSHEET_API_TOKEN environment variable not set');
  }
  return token;
}

async function fetchSmartsheetApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getApiToken();

  const response = await fetch(`${SMARTSHEET_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Smartsheet API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function listSheets(): Promise<Array<{ id: number; name: string; permalink: string }>> {
  const data = await fetchSmartsheetApi<{ data: Array<{ id: number; name: string; permalink: string }> }>('/sheets');
  return data.data;
}

export async function getSheet(sheetId: string | number): Promise<SmartsheetSheet> {
  return fetchSmartsheetApi<SmartsheetSheet>(`/sheets/${sheetId}`);
}

export async function getSheetColumns(sheetId: string | number): Promise<SmartsheetColumn[]> {
  const data = await fetchSmartsheetApi<{ data: SmartsheetColumn[] }>(`/sheets/${sheetId}/columns`);
  return data.data;
}

// ============================================================================
// Sync Config Management
// ============================================================================

export async function getSyncConfig(configId: string): Promise<SmartsheetSyncConfig | null> {
  const result = (await sql`
    SELECT * FROM smartsheet_sync_config WHERE id = ${configId}
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as SmartsheetSyncConfig) : null;
}

export async function getActiveSyncConfigs(): Promise<SmartsheetSyncConfig[]> {
  const result = (await sql`
    SELECT * FROM smartsheet_sync_config WHERE is_active = true ORDER BY created_at
  `) as Record<string, unknown>[];

  return result as unknown as SmartsheetSyncConfig[];
}

export async function createSyncConfig(input: CreateSyncConfigInput): Promise<SmartsheetSyncConfig> {
  const result = (await sql`
    INSERT INTO smartsheet_sync_config (
      sheet_id, sheet_name, workspace_id, workspace_name,
      sync_direction, sync_frequency_minutes,
      column_mappings, status_mappings,
      filter_column_id, filter_values,
      api_token_env_var, created_by
    ) VALUES (
      ${input.sheet_id},
      ${input.sheet_name || null},
      ${input.workspace_id || null},
      ${input.workspace_name || null},
      ${input.sync_direction || 'from_smartsheet'},
      ${input.sync_frequency_minutes || 60},
      ${JSON.stringify(input.column_mappings)},
      ${JSON.stringify(input.status_mappings || {})},
      ${input.filter_column_id || null},
      ${input.filter_values ? JSON.stringify(input.filter_values) : null},
      'SMARTSHEET_API_TOKEN',
      ${input.created_by || null}
    )
    RETURNING *
  `) as Record<string, unknown>[];

  return result[0] as unknown as SmartsheetSyncConfig;
}

export async function updateSyncConfig(
  configId: string,
  input: UpdateSyncConfigInput
): Promise<SmartsheetSyncConfig | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.sheet_name !== undefined) {
    updates.push(`sheet_name = $${paramIndex++}`);
    values.push(input.sheet_name);
  }
  if (input.is_active !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    values.push(input.is_active);
  }
  if (input.sync_direction !== undefined) {
    updates.push(`sync_direction = $${paramIndex++}`);
    values.push(input.sync_direction);
  }
  if (input.sync_frequency_minutes !== undefined) {
    updates.push(`sync_frequency_minutes = $${paramIndex++}`);
    values.push(input.sync_frequency_minutes);
  }
  if (input.column_mappings !== undefined) {
    updates.push(`column_mappings = $${paramIndex++}`);
    values.push(JSON.stringify(input.column_mappings));
  }
  if (input.status_mappings !== undefined) {
    updates.push(`status_mappings = $${paramIndex++}`);
    values.push(JSON.stringify(input.status_mappings));
  }
  if (input.updated_by) {
    updates.push(`updated_by = $${paramIndex++}`);
    values.push(input.updated_by);
  }

  if (updates.length === 0) {
    return getSyncConfig(configId);
  }

  updates.push('updated_at = NOW()');
  values.push(configId);

  const query = `
    UPDATE smartsheet_sync_config
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = (await sql.query(query, values)) as Record<string, unknown>[];
  return result.length > 0 ? (result[0] as unknown as SmartsheetSyncConfig) : null;
}

// ============================================================================
// Sync History
// ============================================================================

export async function createSyncHistory(
  configId: string,
  trigger: SyncTrigger,
  triggeredByUser?: string
): Promise<string> {
  const result = (await sql`
    INSERT INTO smartsheet_sync_history (config_id, triggered_by, triggered_by_user)
    VALUES (${configId}, ${trigger}, ${triggeredByUser || null})
    RETURNING id
  `) as Record<string, unknown>[];

  return result[0].id as string;
}

export async function updateSyncHistory(
  historyId: string,
  status: SyncHistoryStatus,
  stats: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errored: number;
  },
  errors: SyncError[],
  warnings: SyncWarning[],
  durationMs: number
): Promise<void> {
  await sql`
    UPDATE smartsheet_sync_history
    SET
      sync_completed_at = NOW(),
      duration_ms = ${durationMs},
      status = ${status},
      rows_processed = ${stats.processed},
      rows_created = ${stats.created},
      rows_updated = ${stats.updated},
      rows_skipped = ${stats.skipped},
      rows_errored = ${stats.errored},
      error_details = ${JSON.stringify(errors)},
      warnings = ${JSON.stringify(warnings)}
    WHERE id = ${historyId}
  `;
}

export async function getSyncHistory(
  configId: string,
  limit: number = 10
): Promise<SmartsheetSyncHistory[]> {
  const result = (await sql`
    SELECT * FROM smartsheet_sync_history
    WHERE config_id = ${configId}
    ORDER BY sync_started_at DESC
    LIMIT ${limit}
  `) as Record<string, unknown>[];

  return result as unknown as SmartsheetSyncHistory[];
}

// ============================================================================
// Data Parsing
// ============================================================================

function getCellValue(row: SmartsheetRow, columnId: number): string | number | null {
  const cell = row.cells.find(c => c.columnId === columnId);
  return cell?.value ?? null;
}

function parseCoordinates(coordStr: string | null): { lat: number; lng: number } | null {
  if (!coordStr) return null;

  // Format: "27,869419°,-26,32999°" or similar
  const cleaned = coordStr.replace(/°/g, '').replace(/,/g, '.');
  const parts = cleaned.split(/[,\s]+/).filter(p => p);

  if (parts.length >= 2) {
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }
  return null;
}

function parseStakeholderList(text: string | null): string[] {
  if (!text) return [];

  // Filter out common non-stakeholder phrases
  const excludePatterns = [
    /^all /i,
    /^complete$/i,
    /services received/i,
    /services uploaded/i,
    /approval letter/i,
    /renewal/i,
    /ext \d/i,
    /winnie mandela/i,
    /^for /i,
    /uploaded/i,
    /received/i,
    /^to be/i,
  ];

  // Split by common delimiters
  const parts = text.split(/[,&]/).map(s => s.trim()).filter(s => s.length > 2);

  const stakeholders: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();

    // Skip if matches exclude patterns
    if (excludePatterns.some(p => p.test(part))) continue;

    // Check if it maps to a known stakeholder
    if (STAKEHOLDER_TO_CODE[lower]) {
      stakeholders.push(lower);
    } else {
      // Try partial matching for known names
      for (const [name] of Object.entries(STAKEHOLDER_TO_CODE)) {
        if (lower.includes(name) || name.includes(lower)) {
          stakeholders.push(name);
          break;
        }
      }
    }
  }

  return [...new Set(stakeholders)]; // Dedupe
}

// ============================================================================
// Main Sync Function
// ============================================================================

export async function syncFromSmartsheet(
  sheetId: string | number,
  trigger: SyncTrigger = 'manual',
  triggeredByUser?: string
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: SyncError[] = [];
  const warnings: SyncWarning[] = [];
  const stats = { processed: 0, created: 0, updated: 0, skipped: 0, errored: 0 };

  // Get or create sync config
  let config = (await sql`
    SELECT * FROM smartsheet_sync_config WHERE sheet_id = ${String(sheetId)}
  ` as Record<string, unknown>[])[0] as SmartsheetSyncConfig | undefined;

  if (!config) {
    // Auto-create config for Velocity_Master_Tracker
    config = await createSyncConfig({
      sheet_id: String(sheetId),
      sheet_name: 'Velocity_Master_Tracker',
      column_mappings: {},
      created_by: triggeredByUser,
    });
  }

  // Create sync history entry
  const historyId = await createSyncHistory(config.id, trigger, triggeredByUser);

  try {
    // Fetch sheet data
    const sheet = await getSheet(sheetId);

    // Get approval types lookup
    const approvalTypes = (await sql`
      SELECT id, code, name FROM pipeline_approval_types WHERE is_active = true
    `) as { id: string; code: string; name: string }[];
    const approvalTypeMap = new Map(approvalTypes.map(t => [t.code, t.id]));

    // Process each row
    for (const row of sheet.rows) {
      stats.processed++;
      const ssRowId = String(row.id);

      try {
        const projectName = getCellValue(row, VELOCITY_TRACKER_COLUMNS.PROJECT_NAME) as string;
        if (!projectName) {
          stats.skipped++;
          continue;
        }

        // Extract project data
        const region = getCellValue(row, VELOCITY_TRACKER_COLUMNS.REGION) as string;
        const area = getCellValue(row, VELOCITY_TRACKER_COLUMNS.AREA) as string;
        const estimateCount = getCellValue(row, VELOCITY_TRACKER_COLUMNS.ESTIMATE_COUNT) as number;
        const poStatus = getCellValue(row, VELOCITY_TRACKER_COLUMNS.PO_STATUS) as string;
        const customer = getCellValue(row, VELOCITY_TRACKER_COLUMNS.CUSTOMER) as string;
        const networkMethod = getCellValue(row, VELOCITY_TRACKER_COLUMNS.NETWORK_METHOD) as string;
        const mhName = getCellValue(row, VELOCITY_TRACKER_COLUMNS.MH_NAME) as string;
        const mhCoords = getCellValue(row, VELOCITY_TRACKER_COLUMNS.MH_COORDS) as string;
        const nearestBh = getCellValue(row, VELOCITY_TRACKER_COLUMNS.NEAREST_BH) as string;
        const commentOther = getCellValue(row, VELOCITY_TRACKER_COLUMNS.COMMENT_OTHER) as string;

        // New fields (Jan 2026)
        const wayleaveStart = getCellValue(row, VELOCITY_TRACKER_COLUMNS.WAYLEAVE_START) as string;
        const wayleaveEnd = getCellValue(row, VELOCITY_TRACKER_COLUMNS.WAYLEAVE_END) as string;
        const cessionDate = getCellValue(row, VELOCITY_TRACKER_COLUMNS.CESSION_DATE) as string;
        const cessionSigned = getCellValue(row, VELOCITY_TRACKER_COLUMNS.CESSION_SIGNED) as string;

        // Wayleave data
        const wlAppDate = getCellValue(row, VELOCITY_TRACKER_COLUMNS.WAYLEAVE_APPLICATION_DATE) as string;
        const wlStatus = getCellValue(row, VELOCITY_TRACKER_COLUMNS.WAYLEAVE_STATUS) as string;
        const wlExpiryDate = getCellValue(row, VELOCITY_TRACKER_COLUMNS.WAYLEAVE_EXPIRATION_DATE) as string;
        const wlComments = getCellValue(row, VELOCITY_TRACKER_COLUMNS.WAYLEAVE_COMMENTS) as string;

        // Stakeholders
        const stakeholdersReceived = getCellValue(row, VELOCITY_TRACKER_COLUMNS.STAKEHOLDER_RECEIVED) as string;
        const stakeholdersOutstanding = getCellValue(row, VELOCITY_TRACKER_COLUMNS.STAKEHOLDER_OUTSTANDING) as string;

        // Parse coordinates
        const coordinates = parseCoordinates(mhCoords);

        // Map pipeline status
        const pipelineStatus = poStatus ? (PO_STATUS_MAP[poStatus] || 'approvals_in_progress') : 'new';

        // Check if project exists
        const existingProject = (await sql`
          SELECT id FROM pipeline_projects
          WHERE smartsheet_id = ${ssRowId}
          OR (LOWER(project_name) = LOWER(${projectName}) AND province = ${region})
        `) as { id: string }[];

        let projectId: string;

        if (existingProject.length > 0) {
          // Update existing project
          projectId = existingProject[0].id;
          await sql`
            UPDATE pipeline_projects SET
              project_name = ${projectName},
              province = ${region},
              area = ${area},
              estimated_homes_passed = ${estimateCount || null},
              pipeline_status = ${pipelineStatus},
              coordinates = ${coordinates ? JSON.stringify(coordinates) : null},
              notes = ${commentOther || null},
              custom_fields = ${JSON.stringify({
                network_method: networkMethod,
                mh_name: mhName,
                nearest_bh: nearestBh,
                customer: customer,
                wayleave_start: wayleaveStart,
                wayleave_end: wayleaveEnd,
                cession_date: cessionDate,
                cession_signed: cessionSigned,
              })},
              smartsheet_id = ${ssRowId},
              smartsheet_sheet_id = ${String(sheetId)},
              last_synced_at = NOW(),
              sync_status = 'synced'
            WHERE id = ${projectId}
          `;
          stats.updated++;
        } else {
          // Create new project
          const newProject = (await sql`
            INSERT INTO pipeline_projects (
              project_name, province, area, estimated_homes_passed,
              pipeline_status, coordinates, notes, custom_fields,
              smartsheet_id, smartsheet_sheet_id, last_synced_at, sync_status
            ) VALUES (
              ${projectName}, ${region}, ${area}, ${estimateCount || null},
              ${pipelineStatus},
              ${coordinates ? JSON.stringify(coordinates) : null},
              ${commentOther || null},
              ${JSON.stringify({
                network_method: networkMethod,
                mh_name: mhName,
                nearest_bh: nearestBh,
                customer: customer,
                wayleave_start: wayleaveStart,
                wayleave_end: wayleaveEnd,
                cession_date: cessionDate,
                cession_signed: cessionSigned,
              })},
              ${ssRowId}, ${String(sheetId)}, NOW(), 'synced'
            )
            RETURNING id
          `) as { id: string }[];
          projectId = newProject[0].id;
          stats.created++;
        }

        // Parse stakeholders and create approvals
        const receivedStakeholders = parseStakeholderList(stakeholdersReceived);
        const outstandingStakeholders = parseStakeholderList(stakeholdersOutstanding);

        // Create approvals for received stakeholders (status: approved)
        for (const stakeholder of receivedStakeholders) {
          const typeCode = STAKEHOLDER_TO_CODE[stakeholder];
          const typeId = approvalTypeMap.get(typeCode);

          if (typeId) {
            await sql`
              INSERT INTO pipeline_project_approvals (
                pipeline_project_id, approval_type_id, status,
                internal_status,
                application_date, expiry_date, notes, last_synced_at
              ) VALUES (
                ${projectId}, ${typeId}, 'approved',
                'ops_approved',
                ${wlAppDate || null}, ${wlExpiryDate || null},
                ${wlComments || null}, NOW()
              )
              ON CONFLICT (pipeline_project_id, approval_type_id)
              DO UPDATE SET
                status = 'approved',
                internal_status = CASE 
                  WHEN pipeline_project_approvals.internal_status = 'pending' THEN 'ops_approved'
                  ELSE pipeline_project_approvals.internal_status
                END,
                expiry_date = EXCLUDED.expiry_date,
                notes = EXCLUDED.notes,
                last_synced_at = NOW()
            `;
          } else {
            warnings.push({
              ss_row_id: ssRowId,
              message: `Unknown stakeholder: ${stakeholder}`,
            });
          }
        }

        // Create approvals for outstanding stakeholders (status: submitted/pending)
        for (const stakeholder of outstandingStakeholders) {
          const typeCode = STAKEHOLDER_TO_CODE[stakeholder];
          const typeId = approvalTypeMap.get(typeCode);

          if (typeId) {
            await sql`
              INSERT INTO pipeline_project_approvals (
                pipeline_project_id, approval_type_id, status,
                application_date, notes, last_synced_at
              ) VALUES (
                ${projectId}, ${typeId}, 'submitted',
                ${wlAppDate || null}, 'Outstanding - from Smartsheet sync', NOW()
              )
              ON CONFLICT (pipeline_project_id, approval_type_id)
              DO UPDATE SET
                status = CASE
                  WHEN pipeline_project_approvals.status = 'approved' THEN 'approved'
                  ELSE 'submitted'
                END,
                last_synced_at = NOW()
            `;
          }
        }

        // Create main wayleave approval if status exists
        if (wlStatus) {
          const mappedStatus = WAYLEAVE_STATUS_MAP[wlStatus] || 'submitted';

          // Use a generic wayleave type or eskom as default
          const wayleaveTypeId = approvalTypeMap.get('wayleave_eskom');
          if (wayleaveTypeId) {
            await sql`
              INSERT INTO pipeline_project_approvals (
                pipeline_project_id, approval_type_id, status, is_required,
                application_date, expiry_date, notes, last_synced_at
              ) VALUES (
                ${projectId}, ${wayleaveTypeId}, ${mappedStatus}, true,
                ${wlAppDate || null}, ${wlExpiryDate || null},
                ${wlComments || null}, NOW()
              )
              ON CONFLICT (pipeline_project_id, approval_type_id)
              DO UPDATE SET
                status = ${mappedStatus},
                expiry_date = EXCLUDED.expiry_date,
                notes = EXCLUDED.notes,
                last_synced_at = NOW()
            `;
          }
        }

      } catch (rowError) {
        stats.errored++;
        errors.push({
          ss_row_id: ssRowId,
          error: rowError instanceof Error ? rowError.message : String(rowError),
        });
      }
    }

    // Update sync config with last sync info
    await sql`
      UPDATE smartsheet_sync_config SET
        last_sync_at = NOW(),
        last_sync_status = 'completed',
        last_sync_rows_processed = ${stats.processed}
      WHERE id = ${config.id}
    `;

    // Update history
    const durationMs = Date.now() - startTime;
    await updateSyncHistory(
      historyId,
      errors.length > 0 ? 'partial' : 'completed',
      stats,
      errors,
      warnings,
      durationMs
    );

    return {
      success: errors.length === 0,
      historyId,
      stats,
      errors,
      warnings,
      duration_ms: durationMs,
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    errors.push({ ss_row_id: '0', error: errorMsg });

    await updateSyncHistory(historyId, 'failed', stats, errors, warnings, durationMs);

    await sql`
      UPDATE smartsheet_sync_config SET
        last_sync_at = NOW(),
        last_sync_status = 'failed',
        last_sync_error = ${errorMsg}
      WHERE sheet_id = ${String(sheetId)}
    `;

    return {
      success: false,
      historyId,
      stats,
      errors,
      warnings,
      duration_ms: durationMs,
    };
  }
}

// ============================================================================
// Export Service
// ============================================================================

export const pipelineSmartsheetService = {
  listSheets,
  getSheet,
  getSheetColumns,
  getSyncConfig,
  getActiveSyncConfigs,
  createSyncConfig,
  updateSyncConfig,
  getSyncHistory,
  syncFromSmartsheet,
};
