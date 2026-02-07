/**
 * Fleet Vehicle Check-In Service
 * Business logic for daily pre-trip inspections
 */

import { neon } from '@neondatabase/serverless';
import {
  CheckTemplate,
  CheckItem,
  CheckRecord,
  CheckResponse,
  CheckPhoto,
  CheckTemplateWithItems,
  CheckRecordWithDetails,
  CreateCheckRecordInput,
  CreateTemplateInput,
  CreateCheckItemInput,
  VehicleAvailabilityResult,
  SyncCheckRecordRequest,
  FleetCheckTemplateRow,
  FleetCheckItemRow,
  FleetCheckRecordRow,
  FleetCheckResponseRow,
  FleetCheckPhotoRow,
  FleetOdometerHistoryRow,
  FleetFuelHistoryRow,
  FleetCheckScheduleRow,
  FleetVehicleThresholdRow,
  rowToCheckTemplate,
  rowToCheckItem,
  rowToCheckRecord,
  rowToCheckResponse,
  rowToCheckPhoto,
  rowToOdometerHistory,
  rowToFuelHistory,
  rowToCheckSchedule,
  rowToVehicleThreshold,
  CheckRecordStatus,
  CheckType,
  OdometerHistory,
  FuelHistory,
  CheckSchedule,
  VehicleThreshold,
  OdometerSource,
} from '../types/check-in.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================================
// Templates
// ============================================================================

/**
 * Get all active templates
 */
export async function getTemplates(): Promise<CheckTemplate[]> {
  const rows = await sql`
    SELECT * FROM fleet_check_templates
    WHERE is_active = true
    ORDER BY is_default DESC, name ASC
  ` as FleetCheckTemplateRow[];

  return rows.map(rowToCheckTemplate);
}

/**
 * Get template by ID with items
 */
export async function getTemplateWithItems(templateId: string): Promise<CheckTemplateWithItems | null> {
  const [templateRow] = await sql`
    SELECT * FROM fleet_check_templates WHERE id = ${templateId}
  ` as FleetCheckTemplateRow[];

  if (!templateRow) return null;

  const itemRows = await sql`
    SELECT * FROM fleet_check_items
    WHERE template_id = ${templateId} AND is_active = true
    ORDER BY display_order ASC
  ` as FleetCheckItemRow[];

  return {
    ...rowToCheckTemplate(templateRow),
    items: itemRows.map(rowToCheckItem),
  };
}

/**
 * Get default template with items
 */
export async function getDefaultTemplate(): Promise<CheckTemplateWithItems | null> {
  const [templateRow] = await sql`
    SELECT * FROM fleet_check_templates
    WHERE is_default = true AND is_active = true
    LIMIT 1
  ` as FleetCheckTemplateRow[];

  if (!templateRow) return null;

  return getTemplateWithItems(templateRow.id);
}

/**
 * Get default template for a specific check type (daily or weekly)
 */
export async function getDefaultTemplateByType(checkType: CheckType): Promise<CheckTemplateWithItems | null> {
  const [templateRow] = await sql`
    SELECT * FROM fleet_check_templates
    WHERE check_type = ${checkType} AND is_default = true AND is_active = true
    LIMIT 1
  ` as FleetCheckTemplateRow[];

  if (!templateRow) return null;

  return getTemplateWithItems(templateRow.id);
}

/**
 * Get templates by check type
 */
export async function getTemplatesByType(checkType: CheckType): Promise<CheckTemplate[]> {
  const rows = await sql`
    SELECT * FROM fleet_check_templates
    WHERE check_type = ${checkType} AND is_active = true
    ORDER BY is_default DESC, name ASC
  ` as FleetCheckTemplateRow[];

  return rows.map(rowToCheckTemplate);
}

/**
 * Create a new template
 */
export async function createTemplate(input: CreateTemplateInput): Promise<CheckTemplate> {
  // If setting as default, unset other defaults for same check_type
  const checkType = input.checkType || 'daily';
  if (input.isDefault) {
    await sql`UPDATE fleet_check_templates SET is_default = false WHERE is_default = true AND check_type = ${checkType}`;
  }

  const [row] = await sql`
    INSERT INTO fleet_check_templates (name, description, check_type, is_default)
    VALUES (${input.name}, ${input.description || null}, ${checkType}, ${input.isDefault || false})
    RETURNING *
  ` as FleetCheckTemplateRow[];

  if (!row) {
    throw new Error('Failed to create template');
  }

  return rowToCheckTemplate(row);
}

/**
 * Update a template
 */
export async function updateTemplate(
  templateId: string,
  input: Partial<CreateTemplateInput>
): Promise<CheckTemplate | null> {
  // If setting as default, unset other defaults
  if (input.isDefault) {
    await sql`UPDATE fleet_check_templates SET is_default = false WHERE is_default = true AND id != ${templateId}`;
  }

  const [row] = await sql`
    UPDATE fleet_check_templates
    SET
      name = COALESCE(${input.name || null}, name),
      description = COALESCE(${input.description || null}, description),
      is_default = COALESCE(${input.isDefault ?? null}, is_default),
      updated_at = NOW()
    WHERE id = ${templateId}
    RETURNING *
  ` as FleetCheckTemplateRow[];

  return row ? rowToCheckTemplate(row) : null;
}

/**
 * Soft-delete a template
 */
export async function deleteTemplate(templateId: string): Promise<boolean> {
  const result = await sql`
    UPDATE fleet_check_templates SET is_active = false WHERE id = ${templateId} RETURNING id
  `;
  return result.length > 0;
}

// ============================================================================
// Check Items
// ============================================================================

/**
 * Get items for a template
 */
export async function getItemsForTemplate(templateId: string): Promise<CheckItem[]> {
  const rows = await sql`
    SELECT * FROM fleet_check_items
    WHERE template_id = ${templateId} AND is_active = true
    ORDER BY display_order ASC
  ` as FleetCheckItemRow[];

  return rows.map(rowToCheckItem);
}

/**
 * Create a check item
 */
export async function createCheckItem(input: CreateCheckItemInput): Promise<CheckItem> {
  const [row] = await sql`
    INSERT INTO fleet_check_items (template_id, name, description, category, is_critical, display_order)
    VALUES (
      ${input.templateId},
      ${input.name},
      ${input.description || null},
      ${input.category || null},
      ${input.isCritical || false},
      ${input.displayOrder || 0}
    )
    RETURNING *
  ` as FleetCheckItemRow[];

  if (!row) {
    throw new Error('Failed to create check item');
  }

  return rowToCheckItem(row);
}

/**
 * Update a check item
 */
export async function updateCheckItem(
  itemId: string,
  input: Partial<Omit<CreateCheckItemInput, 'templateId'>>
): Promise<CheckItem | null> {
  const [row] = await sql`
    UPDATE fleet_check_items
    SET
      name = COALESCE(${input.name || null}, name),
      description = COALESCE(${input.description || null}, description),
      category = COALESCE(${input.category || null}, category),
      is_critical = COALESCE(${input.isCritical ?? null}, is_critical),
      display_order = COALESCE(${input.displayOrder ?? null}, display_order)
    WHERE id = ${itemId}
    RETURNING *
  ` as FleetCheckItemRow[];

  return row ? rowToCheckItem(row) : null;
}

/**
 * Soft-delete a check item
 */
export async function deleteCheckItem(itemId: string): Promise<boolean> {
  const result = await sql`
    UPDATE fleet_check_items SET is_active = false WHERE id = ${itemId} RETURNING id
  `;
  return result.length > 0;
}

/**
 * Reorder check items
 */
export async function reorderCheckItems(
  templateId: string,
  itemIds: string[]
): Promise<void> {
  for (let i = 0; i < itemIds.length; i++) {
    await sql`
      UPDATE fleet_check_items
      SET display_order = ${i}
      WHERE id = ${itemIds[i]} AND template_id = ${templateId}
    `;
  }
}

// ============================================================================
// Check Records
// ============================================================================

/**
 * Create a check record with responses
 */
export async function createCheckRecord(input: CreateCheckRecordInput): Promise<CheckRecord> {
  // Determine if there are critical or minor issues
  // Also flag as minor issue if VLM confidence is low (photos need manual review)
  const hasCritical = input.responses.some(r => !r.isPassed && r.severity === 'critical');
  const hasMinor = input.responses.some(r => !r.isPassed && r.severity === 'minor') || input.hasLowVlmConfidence;
  const checkType = input.checkType || 'daily';

  // Insert the record
  const [recordRow] = await sql`
    INSERT INTO fleet_check_records (
      vehicle_id, template_id, driver_id, driver_name, check_type,
      odometer_reading, has_critical_issues, has_minor_issues,
      offline_id, sync_status
    )
    VALUES (
      ${input.vehicleId},
      ${input.templateId || null},
      ${input.driverId},
      ${input.driverName},
      ${checkType},
      ${input.odometerReading || null},
      ${hasCritical},
      ${hasMinor},
      ${input.offlineId || null},
      ${input.offlineId ? 'synced' : 'synced'}
    )
    RETURNING *
  ` as FleetCheckRecordRow[];

  if (!recordRow) {
    throw new Error('Failed to create check record');
  }

  // Insert responses
  for (const response of input.responses) {
    await sql`
      INSERT INTO fleet_check_responses (record_id, item_id, is_passed, severity, notes)
      VALUES (
        ${recordRow.id},
        ${response.itemId},
        ${response.isPassed},
        ${response.severity || null},
        ${response.notes || null}
      )
    `;
  }

  // Update check schedule
  await updateCheckScheduleAfterCheckIn(input.vehicleId, checkType);

  // Record odometer reading to history (ensures persistence even if VLM fails)
  // This captures the final value submitted (whether from VLM auto-fill, manual entry, or HITL override)
  if (input.odometerReading) {
    await recordOdometerReading({
      vehicleId: input.vehicleId,
      checkRecordId: recordRow.id,
      reading: input.odometerReading,
      source: input.odometerSource || 'check_in',
    });
  }

  // Record fuel level to history (ensures persistence even if VLM fails)
  // This captures the final value submitted (whether from VLM auto-fill or manual entry)
  if (input.fuelLevel !== undefined && input.fuelLevel !== null) {
    await recordFuelLevel({
      vehicleId: input.vehicleId,
      checkRecordId: recordRow.id,
      fuelLevel: input.fuelLevel,
      source: input.fuelSource || 'check_in',
    });
  }

  return rowToCheckRecord(recordRow);
}

/**
 * Get check record by ID with full details
 */
export async function getCheckRecordWithDetails(recordId: string): Promise<CheckRecordWithDetails | null> {
  // Get record with vehicle info
  const [recordRow] = await sql`
    SELECT
      r.*,
      v.registration,
      v.make,
      v.model
    FROM fleet_check_records r
    JOIN fleet_vehicles v ON v.id = r.vehicle_id
    WHERE r.id = ${recordId}
  ` as (FleetCheckRecordRow & { registration: string; make: string | null; model: string | null })[];

  if (!recordRow) return null;

  // Get responses with item details
  const responseRows = await sql`
    SELECT
      r.*,
      i.id as item_id,
      i.template_id as item_template_id,
      i.name as item_name,
      i.description as item_description,
      i.category as item_category,
      i.is_critical as item_is_critical,
      i.display_order as item_display_order,
      i.is_active as item_is_active,
      i.created_at as item_created_at
    FROM fleet_check_responses r
    JOIN fleet_check_items i ON i.id = r.item_id
    WHERE r.record_id = ${recordId}
    ORDER BY i.display_order ASC
  `;

  // Get photos
  const photoRows = await sql`
    SELECT * FROM fleet_check_photos WHERE record_id = ${recordId}
  ` as FleetCheckPhotoRow[];

  return {
    ...rowToCheckRecord(recordRow),
    vehicle: {
      registration: recordRow.registration,
      make: recordRow.make,
      model: recordRow.model,
    },
    responses: responseRows.map(row => ({
      ...rowToCheckResponse(row as FleetCheckResponseRow),
      item: {
        id: row.item_id,
        templateId: row.item_template_id,
        name: row.item_name,
        description: row.item_description,
        category: row.item_category,
        isCritical: row.item_is_critical,
        displayOrder: row.item_display_order,
        isActive: row.item_is_active,
        createdAt: row.item_created_at,
      },
    })),
    photos: photoRows.map(rowToCheckPhoto),
  };
}

/**
 * Get check records for a vehicle
 */
export async function getCheckRecordsForVehicle(
  vehicleId: string,
  options?: { limit?: number; offset?: number; status?: CheckRecordStatus }
): Promise<CheckRecord[]> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  let rows: FleetCheckRecordRow[];

  if (options?.status) {
    rows = await sql`
      SELECT * FROM fleet_check_records
      WHERE vehicle_id = ${vehicleId} AND status = ${options.status}
      ORDER BY check_date DESC, check_time DESC
      LIMIT ${limit} OFFSET ${offset}
    ` as FleetCheckRecordRow[];
  } else {
    rows = await sql`
      SELECT * FROM fleet_check_records
      WHERE vehicle_id = ${vehicleId}
      ORDER BY check_date DESC, check_time DESC
      LIMIT ${limit} OFFSET ${offset}
    ` as FleetCheckRecordRow[];
  }

  return rows.map(rowToCheckRecord);
}

/**
 * Get all check records with pagination
 */
export async function getCheckRecords(options?: {
  limit?: number;
  offset?: number;
  status?: CheckRecordStatus;
  driverId?: string;
  vehicleId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ records: CheckRecordWithDetails[]; total: number }> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  // Build parameterized query conditions
  const conditions: string[] = ['1=1'];
  const params: (string | number)[] = [];
  if (options?.status) {
    params.push(options.status);
    conditions.push(`r.status = $${params.length}`);
  }
  if (options?.driverId) {
    params.push(options.driverId);
    conditions.push(`r.driver_id = $${params.length}`);
  }
  if (options?.vehicleId) {
    params.push(options.vehicleId);
    conditions.push(`r.vehicle_id = $${params.length}`);
  }
  if (options?.dateFrom) {
    params.push(options.dateFrom);
    conditions.push(`r.check_date >= $${params.length}`);
  }
  if (options?.dateTo) {
    params.push(options.dateTo);
    conditions.push(`r.check_date <= $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  // Get records with vehicle info
  const rows = await sql.unsafe(
    `SELECT
      r.*,
      v.registration,
      v.make,
      v.model
    FROM fleet_check_records r
    JOIN fleet_vehicles v ON v.id = r.vehicle_id
    WHERE ${whereClause}
    ORDER BY r.check_date DESC, r.check_time DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset]
  ) as (FleetCheckRecordRow & { registration: string; make: string | null; model: string | null })[];

  // Get total count
  const countResult = await sql.unsafe(
    `SELECT COUNT(*) as count FROM fleet_check_records r
    WHERE ${whereClause}`,
    params
  ) as { count: string }[];
  const count = countResult[0]?.count ?? '0';

  // Get responses and photos for each record
  const records: CheckRecordWithDetails[] = [];
  for (const row of rows) {
    const responseRows = await sql`
      SELECT
        r.*,
        i.id as item_id,
        i.template_id as item_template_id,
        i.name as item_name,
        i.description as item_description,
        i.category as item_category,
        i.is_critical as item_is_critical,
        i.display_order as item_display_order,
        i.is_active as item_is_active,
        i.created_at as item_created_at
      FROM fleet_check_responses r
      JOIN fleet_check_items i ON i.id = r.item_id
      WHERE r.record_id = ${row.id}
      ORDER BY i.display_order ASC
    `;

    const photoRows = await sql`
      SELECT * FROM fleet_check_photos WHERE record_id = ${row.id}
    ` as FleetCheckPhotoRow[];

    records.push({
      ...rowToCheckRecord(row),
      vehicle: {
        registration: row.registration,
        make: row.make,
        model: row.model,
      },
      responses: responseRows.map(r => ({
        ...rowToCheckResponse(r as FleetCheckResponseRow),
        item: {
          id: r.item_id,
          templateId: r.item_template_id,
          name: r.item_name,
          description: r.item_description,
          category: r.item_category,
          isCritical: r.item_is_critical,
          displayOrder: r.item_display_order,
          isActive: r.item_is_active,
          createdAt: r.item_created_at,
        },
      })),
      photos: photoRows.map(rowToCheckPhoto),
    });
  }

  return { records, total: parseInt(count, 10) };
}

/**
 * Approve or reject a check record
 */
export async function updateCheckRecordStatus(
  recordId: string,
  status: 'approved' | 'rejected',
  approvedBy: string,
  notes?: string
): Promise<CheckRecord | null> {
  const [row] = await sql`
    UPDATE fleet_check_records
    SET
      status = ${status},
      approved_by = ${approvedBy},
      approved_at = NOW(),
      approval_notes = ${notes || null},
      updated_at = NOW()
    WHERE id = ${recordId}
    RETURNING *
  ` as FleetCheckRecordRow[];

  return row ? rowToCheckRecord(row) : null;
}

/**
 * Delete a check record and all related data (admin only)
 */
export async function deleteCheckRecord(recordId: string): Promise<boolean> {
  // Delete in order: VLM results -> photos -> responses -> odometer history -> fuel history -> record
  await sql`DELETE FROM fleet_photo_vlm_results WHERE photo_id IN (SELECT id FROM fleet_check_photos WHERE record_id = ${recordId})`;
  await sql`DELETE FROM fleet_check_photos WHERE record_id = ${recordId}`;
  await sql`DELETE FROM fleet_check_responses WHERE record_id = ${recordId}`;
  await sql`DELETE FROM fleet_odometer_history WHERE check_record_id = ${recordId}`;
  await sql`DELETE FROM fleet_fuel_history WHERE check_record_id = ${recordId}`;

  const result = await sql`DELETE FROM fleet_check_records WHERE id = ${recordId} RETURNING id`;
  return result.length > 0;
}

// ============================================================================
// Photos
// ============================================================================

/**
 * Add a photo to a check record
 * Supports both legacy local storage and VF Storage Service URLs
 */
export async function addCheckPhoto(input: {
  recordId: string;
  responseId?: string;
  photoType: string;
  isRequired: boolean;
  fileUrl: string;
  filePath?: string;
  fileSize?: number;
  latitude?: number;
  longitude?: number;
  storageServiceUrl?: string; // New: Full URL from VF Storage Service
}): Promise<CheckPhoto> {
  const [row] = await sql`
    INSERT INTO fleet_check_photos (
      record_id, response_id, photo_type, is_required,
      file_url, file_path, file_size, latitude, longitude,
      storage_service_url
    )
    VALUES (
      ${input.recordId},
      ${input.responseId || null},
      ${input.photoType},
      ${input.isRequired},
      ${input.fileUrl},
      ${input.filePath || null},
      ${input.fileSize || null},
      ${input.latitude || null},
      ${input.longitude || null},
      ${input.storageServiceUrl || null}
    )
    RETURNING *
  ` as FleetCheckPhotoRow[];

  if (!row) {
    throw new Error('Failed to add photo');
  }

  return rowToCheckPhoto(row);
}

/**
 * Get photos for a check record
 */
export async function getPhotosForRecord(recordId: string): Promise<CheckPhoto[]> {
  const rows = await sql`
    SELECT * FROM fleet_check_photos WHERE record_id = ${recordId}
  ` as FleetCheckPhotoRow[];

  return rows.map(rowToCheckPhoto);
}

// ============================================================================
// Vehicle Availability
// ============================================================================

/**
 * Check if a vehicle can be used (no critical issues in latest check-in)
 */
export async function checkVehicleAvailability(vehicleId: string): Promise<VehicleAvailabilityResult> {
  // Get the most recent check-in for this vehicle
  const [latestRecord] = await sql`
    SELECT * FROM fleet_check_records
    WHERE vehicle_id = ${vehicleId}
    ORDER BY check_date DESC, check_time DESC
    LIMIT 1
  ` as FleetCheckRecordRow[];

  if (!latestRecord) {
    return {
      canUse: true,
      reason: 'No previous check-in found. Please perform a check-in before use.',
      criticalIssues: [],
      minorIssues: [],
    };
  }

  // Get failed responses with item details
  const failedResponses = await sql`
    SELECT r.*, i.name, i.is_critical
    FROM fleet_check_responses r
    JOIN fleet_check_items i ON i.id = r.item_id
    WHERE r.record_id = ${latestRecord.id} AND r.is_passed = false
  `;

  const criticalIssues: string[] = [];
  const minorIssues: string[] = [];

  for (const response of failedResponses) {
    if (response.is_critical) {
      criticalIssues.push(response.name);
    } else {
      minorIssues.push(response.name);
    }
  }

  const canUse = criticalIssues.length === 0;

  return {
    canUse,
    reason: canUse
      ? minorIssues.length > 0
        ? 'Vehicle has minor issues but can be used'
        : 'Vehicle passed all checks'
      : `Vehicle blocked due to critical issues: ${criticalIssues.join(', ')}`,
    criticalIssues,
    minorIssues,
    lastCheckIn: {
      id: latestRecord.id,
      checkDate: latestRecord.check_date,
      checkTime: latestRecord.check_time,
      driverName: latestRecord.driver_name,
      status: latestRecord.status as CheckRecordStatus,
    },
  };
}

// ============================================================================
// Offline Sync
// ============================================================================

/**
 * Sync an offline check record
 */
export async function syncOfflineCheckRecord(
  request: SyncCheckRecordRequest
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    // Check if already synced (by offlineId)
    const [existing] = await sql`
      SELECT id FROM fleet_check_records WHERE offline_id = ${request.offlineId}
    `;

    if (existing) {
      return { success: true, recordId: existing.id };
    }

    // Create the record
    const record = await createCheckRecord({
      vehicleId: request.vehicleId,
      templateId: request.templateId || undefined,
      driverId: request.driverId,
      driverName: request.driverName,
      odometerReading: request.odometerReading || undefined,
      responses: request.responses,
      offlineId: request.offlineId,
    });

    // Add photos (would need to handle base64 upload separately)
    // For now, return success - photo upload handled by separate endpoint

    return { success: true, recordId: record.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Check sync status for multiple offline IDs
 */
export async function checkSyncStatus(
  offlineIds: string[]
): Promise<Record<string, { synced: boolean; recordId?: string }>> {
  if (offlineIds.length === 0) return {};

  const rows = await sql`
    SELECT id, offline_id FROM fleet_check_records
    WHERE offline_id = ANY(${offlineIds})
  `;

  const result: Record<string, { synced: boolean; recordId?: string }> = {};

  for (const id of offlineIds) {
    const row = rows.find(r => r.offline_id === id);
    result[id] = row
      ? { synced: true, recordId: row.id }
      : { synced: false };
  }

  return result;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get check-in statistics for a vehicle
 */
export async function getVehicleCheckInStats(vehicleId: string): Promise<{
  totalCheckIns: number;
  lastCheckIn: string | null;
  criticalIssueCount: number;
  minorIssueCount: number;
  passRate: number;
}> {
  const [stats] = await sql`
    SELECT
      COUNT(*) as total_check_ins,
      MAX(check_date || ' ' || check_time) as last_check_in,
      SUM(CASE WHEN has_critical_issues THEN 1 ELSE 0 END) as critical_issue_count,
      SUM(CASE WHEN has_minor_issues AND NOT has_critical_issues THEN 1 ELSE 0 END) as minor_issue_count,
      ROUND(
        100.0 * SUM(CASE WHEN NOT has_critical_issues AND NOT has_minor_issues THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
        1
      ) as pass_rate
    FROM fleet_check_records
    WHERE vehicle_id = ${vehicleId}
  `;

  return {
    totalCheckIns: parseInt(stats?.total_check_ins || '0', 10),
    lastCheckIn: stats?.last_check_in || null,
    criticalIssueCount: parseInt(stats?.critical_issue_count || '0', 10),
    minorIssueCount: parseInt(stats?.minor_issue_count || '0', 10),
    passRate: parseFloat(stats?.pass_rate || '0'),
  };
}

/**
 * Get fleet-wide check-in statistics
 */
export async function getFleetCheckInStats(): Promise<{
  totalCheckIns: number;
  todayCheckIns: number;
  pendingApprovals: number;
  vehiclesWithCriticalIssues: number;
}> {
  const [stats] = await sql`
    SELECT
      COUNT(*) as total_check_ins,
      SUM(CASE WHEN check_date = CURRENT_DATE THEN 1 ELSE 0 END) as today_check_ins,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_approvals
    FROM fleet_check_records
  `;

  const [criticalStats] = await sql`
    SELECT COUNT(DISTINCT vehicle_id) as count
    FROM fleet_check_records r1
    WHERE has_critical_issues = true
    AND check_date = (
      SELECT MAX(check_date)
      FROM fleet_check_records r2
      WHERE r2.vehicle_id = r1.vehicle_id
    )
  `;

  return {
    totalCheckIns: parseInt(stats?.total_check_ins || '0', 10),
    todayCheckIns: parseInt(stats?.today_check_ins || '0', 10),
    pendingApprovals: parseInt(stats?.pending_approvals || '0', 10),
    vehiclesWithCriticalIssues: parseInt(criticalStats?.count || '0', 10),
  };
}

// ============================================================================
// Odometer History
// ============================================================================

/**
 * Record an odometer reading
 * @param input.discrepancyFlag - Optional override from VLM validation
 * @param input.discrepancyReason - Optional reason from VLM validation
 */
export async function recordOdometerReading(input: {
  vehicleId: string;
  checkRecordId?: string;
  reading: number;
  source: OdometerSource;
  vlmConfidence?: number;
  discrepancyFlag?: boolean;
  discrepancyReason?: string;
}): Promise<OdometerHistory> {
  // Get the previous reading for comparison
  const [previousRow] = await sql`
    SELECT reading, recorded_at FROM fleet_odometer_history
    WHERE vehicle_id = ${input.vehicleId}
    ORDER BY recorded_at DESC
    LIMIT 1
  ` as { reading: number; recorded_at: string }[];

  const previousReading = previousRow?.reading || null;
  const kmSinceLast = previousReading !== null ? input.reading - previousReading : null;

  // Use override from validation if provided, otherwise calculate locally
  let discrepancyFlag = input.discrepancyFlag ?? false;
  let discrepancyReason: string | null = input.discrepancyReason ?? null;

  // If no override provided, do local check for basic discrepancies
  if (!input.discrepancyFlag && kmSinceLast !== null) {
    // Get vehicle thresholds
    const threshold = await getVehicleThreshold(input.vehicleId);
    const dailyThreshold = threshold?.dailyKmThreshold || 500;

    // Check for rollback
    if (kmSinceLast < 0) {
      discrepancyFlag = true;
      discrepancyReason = `Odometer rollback: ${input.reading} km < previous ${previousReading} km`;
    }
    // Check for excessive km (assume 1 day between checks for now)
    else if (kmSinceLast > dailyThreshold) {
      discrepancyFlag = true;
      discrepancyReason = `Excessive km: ${kmSinceLast} km exceeds ${dailyThreshold} km/day threshold`;
    }
  }

  const [row] = await sql`
    INSERT INTO fleet_odometer_history (
      vehicle_id, check_record_id, reading, source, vlm_confidence,
      previous_reading, km_since_last, discrepancy_flag, discrepancy_reason
    )
    VALUES (
      ${input.vehicleId},
      ${input.checkRecordId || null},
      ${input.reading},
      ${input.source},
      ${input.vlmConfidence || null},
      ${previousReading},
      ${kmSinceLast},
      ${discrepancyFlag},
      ${discrepancyReason}
    )
    RETURNING *
  ` as FleetOdometerHistoryRow[];

  if (!row) {
    throw new Error('Failed to record odometer reading');
  }

  return rowToOdometerHistory(row);
}

/**
 * Get odometer history for a vehicle
 */
export async function getOdometerHistory(
  vehicleId: string,
  limit = 30
): Promise<OdometerHistory[]> {
  const rows = await sql`
    SELECT * FROM fleet_odometer_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT ${limit}
  ` as FleetOdometerHistoryRow[];

  return rows.map(rowToOdometerHistory);
}

/**
 * Get the latest odometer reading for a vehicle
 */
export async function getLatestOdometerReading(vehicleId: string): Promise<OdometerHistory | null> {
  const [row] = await sql`
    SELECT * FROM fleet_odometer_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT 1
  ` as FleetOdometerHistoryRow[];

  return row ? rowToOdometerHistory(row) : null;
}

// ============================================================================
// Fuel History
// ============================================================================

/**
 * Record a fuel level reading
 */
export async function recordFuelLevel(input: {
  vehicleId: string;
  checkRecordId?: string;
  fuelLevel: number;
  source: OdometerSource;
  vlmConfidence?: number;
}): Promise<FuelHistory> {
  // Get the previous level for comparison
  const [previousRow] = await sql`
    SELECT fuel_level FROM fleet_fuel_history
    WHERE vehicle_id = ${input.vehicleId}
    ORDER BY recorded_at DESC
    LIMIT 1
  ` as { fuel_level: number }[];

  const previousLevel = previousRow?.fuel_level || null;
  const levelChange = previousLevel !== null ? input.fuelLevel - previousLevel : null;

  const [row] = await sql`
    INSERT INTO fleet_fuel_history (
      vehicle_id, check_record_id, fuel_level, source, vlm_confidence,
      previous_level, level_change
    )
    VALUES (
      ${input.vehicleId},
      ${input.checkRecordId || null},
      ${input.fuelLevel},
      ${input.source},
      ${input.vlmConfidence || null},
      ${previousLevel},
      ${levelChange}
    )
    RETURNING *
  ` as FleetFuelHistoryRow[];

  if (!row) {
    throw new Error('Failed to record fuel level');
  }

  return rowToFuelHistory(row);
}

/**
 * Get fuel history for a vehicle
 */
export async function getFuelHistory(
  vehicleId: string,
  limit = 30
): Promise<FuelHistory[]> {
  const rows = await sql`
    SELECT * FROM fleet_fuel_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT ${limit}
  ` as FleetFuelHistoryRow[];

  return rows.map(rowToFuelHistory);
}

/**
 * Get the latest fuel level for a vehicle
 */
export async function getLatestFuelLevel(vehicleId: string): Promise<FuelHistory | null> {
  const [row] = await sql`
    SELECT * FROM fleet_fuel_history
    WHERE vehicle_id = ${vehicleId}
    ORDER BY recorded_at DESC
    LIMIT 1
  ` as FleetFuelHistoryRow[];

  return row ? rowToFuelHistory(row) : null;
}

// ============================================================================
// Check Schedule
// ============================================================================

/**
 * Get check schedule for a vehicle
 */
export async function getCheckSchedule(vehicleId: string): Promise<CheckSchedule | null> {
  const [row] = await sql`
    SELECT * FROM fleet_check_schedule WHERE vehicle_id = ${vehicleId}
  ` as FleetCheckScheduleRow[];

  return row ? rowToCheckSchedule(row) : null;
}

/**
 * Update check schedule after a check-in
 */
async function updateCheckScheduleAfterCheckIn(
  vehicleId: string,
  checkType: CheckType
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  if (checkType === 'daily') {
    await sql`
      INSERT INTO fleet_check_schedule (vehicle_id, daily_last_check, reminder_sent_daily)
      VALUES (${vehicleId}, ${today}, false)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        daily_last_check = ${today},
        reminder_sent_daily = false,
        updated_at = NOW()
    `;
  } else {
    await sql`
      INSERT INTO fleet_check_schedule (vehicle_id, weekly_last_check, reminder_sent_weekly)
      VALUES (${vehicleId}, ${today}, false)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        weekly_last_check = ${today},
        reminder_sent_weekly = false,
        updated_at = NOW()
    `;
  }
}

/**
 * Get vehicles needing daily check
 */
export async function getVehiclesNeedingDailyCheck(): Promise<string[]> {
  const today = new Date().toISOString().split('T')[0];

  const rows = await sql`
    SELECT v.id
    FROM fleet_vehicles v
    LEFT JOIN fleet_check_schedule s ON s.vehicle_id = v.id
    WHERE v.status = 'active'
    AND (s.daily_last_check IS NULL OR s.daily_last_check < ${today})
    AND (s.weekly_last_check IS NULL OR s.weekly_last_check < ${today})
  ` as { id: string }[];

  return rows.map(r => r.id);
}

/**
 * Get vehicles needing weekly check (on Mondays)
 */
export async function getVehiclesNeedingWeeklyCheck(): Promise<string[]> {
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon

  // Only check on Mondays
  if (dayOfWeek !== 1) return [];

  const rows = await sql`
    SELECT v.id
    FROM fleet_vehicles v
    LEFT JOIN fleet_check_schedule s ON s.vehicle_id = v.id
    WHERE v.status = 'active'
    AND (s.weekly_last_check IS NULL OR s.weekly_last_check < ${today} - INTERVAL '6 days')
  ` as { id: string }[];

  return rows.map(r => r.id);
}

/**
 * Mark reminder as sent for a vehicle
 */
export async function markReminderSent(
  vehicleId: string,
  checkType: CheckType
): Promise<void> {
  if (checkType === 'daily') {
    await sql`
      UPDATE fleet_check_schedule
      SET reminder_sent_daily = true, updated_at = NOW()
      WHERE vehicle_id = ${vehicleId}
    `;
  } else {
    await sql`
      UPDATE fleet_check_schedule
      SET reminder_sent_weekly = true, updated_at = NOW()
      WHERE vehicle_id = ${vehicleId}
    `;
  }
}

/**
 * Reset daily reminders (called at midnight)
 */
export async function resetDailyReminders(): Promise<void> {
  await sql`
    UPDATE fleet_check_schedule
    SET reminder_sent_daily = false, updated_at = NOW()
  `;
}

// ============================================================================
// Vehicle Thresholds
// ============================================================================

/**
 * Get vehicle threshold configuration
 */
export async function getVehicleThreshold(vehicleId: string): Promise<VehicleThreshold | null> {
  const [row] = await sql`
    SELECT * FROM fleet_vehicle_thresholds WHERE vehicle_id = ${vehicleId}
  ` as FleetVehicleThresholdRow[];

  return row ? rowToVehicleThreshold(row) : null;
}

/**
 * Update vehicle threshold configuration
 */
export async function updateVehicleThreshold(
  vehicleId: string,
  input: {
    dailyKmThreshold?: number;
    weeklyKmThreshold?: number;
  }
): Promise<VehicleThreshold> {
  const [row] = await sql`
    INSERT INTO fleet_vehicle_thresholds (vehicle_id, daily_km_threshold, weekly_km_threshold)
    VALUES (
      ${vehicleId},
      ${input.dailyKmThreshold || 500},
      ${input.weeklyKmThreshold || 1000}
    )
    ON CONFLICT (vehicle_id) DO UPDATE SET
      daily_km_threshold = COALESCE(${input.dailyKmThreshold || null}, fleet_vehicle_thresholds.daily_km_threshold),
      weekly_km_threshold = COALESCE(${input.weeklyKmThreshold || null}, fleet_vehicle_thresholds.weekly_km_threshold),
      updated_at = NOW()
    RETURNING *
  ` as FleetVehicleThresholdRow[];

  if (!row) {
    throw new Error('Failed to update vehicle threshold');
  }

  return rowToVehicleThreshold(row);
}

/**
 * Determine which check type is needed for a vehicle today
 */
export async function getRequiredCheckType(vehicleId: string): Promise<CheckType | null> {
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon

  const schedule = await getCheckSchedule(vehicleId);

  // If Monday and no weekly check done this week, require weekly
  if (dayOfWeek === 1) {
    const weekAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = weekAgoDate.split('T')[0] ?? weekAgoDate.substring(0, 10);
    if (!schedule?.weeklyLastCheck || schedule.weeklyLastCheck < weekAgo) {
      return 'weekly';
    }
  }

  // If weekly check done today, no daily needed
  if (schedule?.weeklyLastCheck === today) {
    return null;
  }

  // If daily check already done today, no check needed
  if (schedule?.dailyLastCheck === today) {
    return null;
  }

  // Otherwise, daily check needed
  return 'daily';
}
