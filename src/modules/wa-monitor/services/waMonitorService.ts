/**
 * WA Monitor Backend Service
 * Database operations for QA review drops
 * Uses Neon PostgreSQL serverless client
 *
 * ⚠️ CRITICAL: This service queries the `qa_photo_reviews` table
 * DO NOT confuse with the `drops` table (used for SOW imports)
 *
 * Table: qa_photo_reviews
 * Source: WhatsApp messages via realtime_drop_monitor.py
 * Projects: Lawley, Velo Test, Mohadin
 *
 * See: docs/DATABASE_TABLES.md for full reference
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { QaReviewDrop, WaMonitorSummary } from '../types/wa-monitor.types';

// Database connection - initialized lazily at runtime
function getDbConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

// ==================== FETCH OPERATIONS ====================

/**
 * Get all QA review drops (DEPRECATED - use getPaginatedDrops for better performance)
 * Returns all drops ordered by created_at DESC (newest first)
 * Enriched with OneMap serial data (ONT barcode, activation code, installer info)
 *
 * @deprecated Use getPaginatedDrops() instead - fetching all 3600+ rows is slow
 */
export async function getAllDrops(): Promise<QaReviewDrop[]> {
  try {
    const sql = getDbConnection();
    // Main query with LEFT JOIN to onemap_properties for serial data
    // Uses DISTINCT ON to get only one OneMap record per drop (most recent)
    const rows = await sql`
      SELECT
        q.id,
        q.drop_number as "dropNumber",
        q.review_date as "reviewDate",
        q.user_name as "userName",
        q.completed_photos as "completedPhotos",
        q.outstanding_photos as "outstandingPhotos",
        q.outstanding_photos_loaded_to_1map as "outstandingPhotosLoadedTo1map",
        q.comment,
        q.created_at as "createdAt",
        q.updated_at as "updatedAt",
        q.project,
        q.assigned_agent as "assignedAgent",
        q.completed,
        q.incomplete,
        q.feedback_sent as "feedbackSent",
        q.sender_phone as "senderPhone",
        q.resubmitted,
        q.locked_by as "lockedBy",
        q.locked_at as "lockedAt",
        q.incorrect_steps as "incorrectSteps",
        q.incorrect_comments as "incorrectComments",
        q.step_01_house_photo as "step_01_house_photo",
        q.step_02_cable_from_pole as "step_02_cable_from_pole",
        q.step_03_cable_entry_outside as "step_03_cable_entry_outside",
        q.step_04_cable_entry_inside as "step_04_cable_entry_inside",
        q.step_05_wall_for_installation as "step_05_wall_for_installation",
        q.step_06_ont_back_after_install as "step_06_ont_back_after_install",
        q.step_07_power_meter_reading as "step_07_power_meter_reading",
        q.step_08_ont_barcode as "step_08_ont_barcode",
        q.step_09_ups_serial as "step_09_ups_serial",
        q.step_10_final_installation as "step_10_final_installation",
        q.step_11_green_lights as "step_11_green_lights",
        q.step_12_customer_signature as "step_12_customer_signature",
        q.ont_serial_scanned as "ontSerialScanned",
        q.ups_serial_scanned as "upsSerialScanned",
        q.ont_consumption_id as "ontConsumptionId",
        q.ups_consumption_id as "upsConsumptionId",
        q.scan_gps_lat as "scanGpsLat",
        q.scan_gps_lng as "scanGpsLng",
        -- OneMap serial data (from onemap_properties table by drop_number)
        op.ont_barcode as "onemapOntBarcode",
        op.ont_activation_code as "onemapOntActivationCode",
        op.ups_serial as "onemapUpsSerial",
        op.installer_name as "onemapInstallerName",
        op.installation_date as "onemapInstallationDate"
      FROM qa_photo_reviews q
      LEFT JOIN LATERAL (
        SELECT ont_barcode, ont_activation_code, ups_serial, installer_name, installation_date
        FROM onemap_properties
        WHERE drop_number = q.drop_number
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1
      ) op ON true
      WHERE q.project != 'Marketing Activations'
      ORDER BY q.created_at DESC
    `;

    return rows.map(transformDbRowToDrop);
  } catch (error) {
    log.error('Error fetching all drops', { error }, 'waMonitorService.getAllDrops');
    throw new Error('Failed to fetch QA review drops');
  }
}

/**
 * Pagination result type for getPaginatedDrops
 */
export interface PaginatedDropsResult {
  drops: QaReviewDrop[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalDrops: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Get paginated QA review drops with server-side pagination
 * Much faster than getAllDrops() - only fetches the requested page
 *
 * @param page - Page number (1-indexed)
 * @param pageSize - Number of drops per page (max 1000)
 * @param search - Optional search term for drop_number or project
 * @returns Paginated drops with total count
 */
export async function getPaginatedDrops(
  page: number = 1,
  pageSize: number = 100,
  search?: string
): Promise<PaginatedDropsResult> {
  try {
    const sql = getDbConnection();

    // Ensure valid pagination params
    const validPage = Math.max(1, page);
    const validPageSize = Math.min(1000, Math.max(1, pageSize));
    const offset = (validPage - 1) * validPageSize;

    // Get total count first (with search filter if provided)
    let totalCount: number;
    if (search) {
      const searchPattern = `%${search.toLowerCase()}%`;
      const [countResult] = await sql`
        SELECT COUNT(*) as count
        FROM qa_photo_reviews q
        WHERE q.project != 'Marketing Activations'
          AND (LOWER(q.drop_number) LIKE ${searchPattern} OR LOWER(q.project) LIKE ${searchPattern})
      `;
      totalCount = parseInt(countResult.count, 10);
    } else {
      const [countResult] = await sql`
        SELECT COUNT(*) as count
        FROM qa_photo_reviews q
        WHERE q.project != 'Marketing Activations'
      `;
      totalCount = parseInt(countResult.count, 10);
    }

    // Get paginated data with LIMIT/OFFSET
    let rows;
    if (search) {
      const searchPattern = `%${search.toLowerCase()}%`;
      rows = await sql`
        SELECT
          q.id,
          q.drop_number as "dropNumber",
          q.review_date as "reviewDate",
          q.user_name as "userName",
          q.completed_photos as "completedPhotos",
          q.outstanding_photos as "outstandingPhotos",
          q.outstanding_photos_loaded_to_1map as "outstandingPhotosLoadedTo1map",
          q.comment,
          q.created_at as "createdAt",
          q.updated_at as "updatedAt",
          q.project,
          q.assigned_agent as "assignedAgent",
          q.completed,
          q.incomplete,
          q.feedback_sent as "feedbackSent",
          q.sender_phone as "senderPhone",
          q.resubmitted,
          q.locked_by as "lockedBy",
          q.locked_at as "lockedAt",
          q.incorrect_steps as "incorrectSteps",
          q.incorrect_comments as "incorrectComments",
          q.step_01_house_photo as "step_01_house_photo",
          q.step_02_cable_from_pole as "step_02_cable_from_pole",
          q.step_03_cable_entry_outside as "step_03_cable_entry_outside",
          q.step_04_cable_entry_inside as "step_04_cable_entry_inside",
          q.step_05_wall_for_installation as "step_05_wall_for_installation",
          q.step_06_ont_back_after_install as "step_06_ont_back_after_install",
          q.step_07_power_meter_reading as "step_07_power_meter_reading",
          q.step_08_ont_barcode as "step_08_ont_barcode",
          q.step_09_ups_serial as "step_09_ups_serial",
          q.step_10_final_installation as "step_10_final_installation",
          q.step_11_green_lights as "step_11_green_lights",
          q.step_12_customer_signature as "step_12_customer_signature",
          q.ont_serial_scanned as "ontSerialScanned",
          q.ups_serial_scanned as "upsSerialScanned",
          q.ont_consumption_id as "ontConsumptionId",
          q.ups_consumption_id as "upsConsumptionId",
          q.scan_gps_lat as "scanGpsLat",
          q.scan_gps_lng as "scanGpsLng",
          op.ont_barcode as "onemapOntBarcode",
          op.ont_activation_code as "onemapOntActivationCode",
          op.ups_serial as "onemapUpsSerial",
          op.installer_name as "onemapInstallerName",
          op.installation_date as "onemapInstallationDate"
        FROM qa_photo_reviews q
        LEFT JOIN LATERAL (
          SELECT ont_barcode, ont_activation_code, ups_serial, installer_name, installation_date
          FROM onemap_properties
          WHERE drop_number = q.drop_number
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1
        ) op ON true
        WHERE q.project != 'Marketing Activations'
          AND (LOWER(q.drop_number) LIKE ${searchPattern} OR LOWER(q.project) LIKE ${searchPattern})
        ORDER BY q.created_at DESC
        LIMIT ${validPageSize}
        OFFSET ${offset}
      `;
    } else {
      rows = await sql`
        SELECT
          q.id,
          q.drop_number as "dropNumber",
          q.review_date as "reviewDate",
          q.user_name as "userName",
          q.completed_photos as "completedPhotos",
          q.outstanding_photos as "outstandingPhotos",
          q.outstanding_photos_loaded_to_1map as "outstandingPhotosLoadedTo1map",
          q.comment,
          q.created_at as "createdAt",
          q.updated_at as "updatedAt",
          q.project,
          q.assigned_agent as "assignedAgent",
          q.completed,
          q.incomplete,
          q.feedback_sent as "feedbackSent",
          q.sender_phone as "senderPhone",
          q.resubmitted,
          q.locked_by as "lockedBy",
          q.locked_at as "lockedAt",
          q.incorrect_steps as "incorrectSteps",
          q.incorrect_comments as "incorrectComments",
          q.step_01_house_photo as "step_01_house_photo",
          q.step_02_cable_from_pole as "step_02_cable_from_pole",
          q.step_03_cable_entry_outside as "step_03_cable_entry_outside",
          q.step_04_cable_entry_inside as "step_04_cable_entry_inside",
          q.step_05_wall_for_installation as "step_05_wall_for_installation",
          q.step_06_ont_back_after_install as "step_06_ont_back_after_install",
          q.step_07_power_meter_reading as "step_07_power_meter_reading",
          q.step_08_ont_barcode as "step_08_ont_barcode",
          q.step_09_ups_serial as "step_09_ups_serial",
          q.step_10_final_installation as "step_10_final_installation",
          q.step_11_green_lights as "step_11_green_lights",
          q.step_12_customer_signature as "step_12_customer_signature",
          q.ont_serial_scanned as "ontSerialScanned",
          q.ups_serial_scanned as "upsSerialScanned",
          q.ont_consumption_id as "ontConsumptionId",
          q.ups_consumption_id as "upsConsumptionId",
          q.scan_gps_lat as "scanGpsLat",
          q.scan_gps_lng as "scanGpsLng",
          op.ont_barcode as "onemapOntBarcode",
          op.ont_activation_code as "onemapOntActivationCode",
          op.ups_serial as "onemapUpsSerial",
          op.installer_name as "onemapInstallerName",
          op.installation_date as "onemapInstallationDate"
        FROM qa_photo_reviews q
        LEFT JOIN LATERAL (
          SELECT ont_barcode, ont_activation_code, ups_serial, installer_name, installation_date
          FROM onemap_properties
          WHERE drop_number = q.drop_number
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1
        ) op ON true
        WHERE q.project != 'Marketing Activations'
        ORDER BY q.created_at DESC
        LIMIT ${validPageSize}
        OFFSET ${offset}
      `;
    }

    const totalPages = Math.ceil(totalCount / validPageSize);

    return {
      drops: rows.map(transformDbRowToDrop),
      pagination: {
        currentPage: validPage,
        pageSize: validPageSize,
        totalDrops: totalCount,
        totalPages,
        hasNextPage: validPage < totalPages,
        hasPreviousPage: validPage > 1,
      },
    };
  } catch (error) {
    log.error('Error fetching paginated drops', { error, page, pageSize, search }, 'waMonitorService.getPaginatedDrops');
    throw new Error('Failed to fetch QA review drops');
  }
}

/**
 * Get a single drop by ID
 */
export async function getDropById(id: string): Promise<QaReviewDrop | null> {
  try {
    const sql = getDbConnection();
    const [row] = await sql`
      SELECT
        id,
        drop_number as "dropNumber",
        status,
        feedback_count as "feedbackCount",
        created_at as "createdAt",
        updated_at as "updatedAt",
        completed_at as "completedAt",
        notes
      FROM qa_reviews
      WHERE id = ${id}
    `;

    return row ? transformDbRowToDrop(row) : null;
  } catch (error) {
    log.error('Error fetching drop by ID', { error, id }, 'waMonitorService.getDropById');
    throw new Error('Failed to fetch QA review drop');
  }
}

/**
 * Get drops by status
 */
export async function getDropsByStatus(status: 'incomplete' | 'complete'): Promise<QaReviewDrop[]> {
  try {
    const sql = getDbConnection();
    const rows = await sql`
      SELECT
        id,
        drop_number as "dropNumber",
        status,
        feedback_count as "feedbackCount",
        created_at as "createdAt",
        updated_at as "updatedAt",
        completed_at as "completedAt",
        notes
      FROM qa_reviews
      WHERE status = ${status}
      ORDER BY created_at DESC
    `;

    return rows.map(transformDbRowToDrop);
  } catch (error) {
    log.error('Error fetching drops by status', { error, status }, 'waMonitorService.getDropsByStatus');
    throw new Error('Failed to fetch QA review drops by status');
  }
}

// ==================== SUMMARY OPERATIONS ====================

/**
 * Calculate summary statistics for all drops
 * Complete = All 12 QA checklist steps are TRUE
 * Incomplete = Any of the 12 QA checklist steps is FALSE
 */
export async function calculateSummary(): Promise<WaMonitorSummary> {
  try {
    const sql = getDbConnection();
    const [stats] = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(CASE
          WHEN step_01_house_photo = true
            AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true
            AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true
            AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true
            AND step_08_ont_barcode = true
            AND step_09_ups_serial = true
            AND step_10_final_installation = true
            AND step_11_green_lights = true
            AND step_12_customer_signature = true
          THEN 1
        END) as complete,
        COUNT(CASE
          WHEN step_01_house_photo = false
            OR step_02_cable_from_pole = false
            OR step_03_cable_entry_outside = false
            OR step_04_cable_entry_inside = false
            OR step_05_wall_for_installation = false
            OR step_06_ont_back_after_install = false
            OR step_07_power_meter_reading = false
            OR step_08_ont_barcode = false
            OR step_09_ups_serial = false
            OR step_10_final_installation = false
            OR step_11_green_lights = false
            OR step_12_customer_signature = false
          THEN 1
        END) as incomplete,
        COALESCE(AVG(completed_photos), 0) as "avgCompletedPhotos",
        COALESCE(SUM(CASE WHEN completed = true OR incomplete = true THEN 1 ELSE 0 END), 0) as "totalReviewed"
      FROM qa_photo_reviews
      WHERE project != 'Marketing Activations'
    `;

    // Get daily stats grouped by project and date (last 30 days only for performance)
    const dailyStatsRows = await sql`
      SELECT
        COALESCE(project, 'Unknown') as project,
        TO_CHAR(DATE(created_at AT TIME ZONE 'Africa/Johannesburg'), 'YYYY-MM-DD') as date,
        COUNT(*) as total,
        COUNT(CASE
          WHEN step_01_house_photo = true
            AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true
            AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true
            AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true
            AND step_08_ont_barcode = true
            AND step_09_ups_serial = true
            AND step_10_final_installation = true
            AND step_11_green_lights = true
            AND step_12_customer_signature = true
          THEN 1
        END) as complete,
        COUNT(CASE
          WHEN step_01_house_photo = false
            OR step_02_cable_from_pole = false
            OR step_03_cable_entry_outside = false
            OR step_04_cable_entry_inside = false
            OR step_05_wall_for_installation = false
            OR step_06_ont_back_after_install = false
            OR step_07_power_meter_reading = false
            OR step_08_ont_barcode = false
            OR step_09_ups_serial = false
            OR step_10_final_installation = false
            OR step_11_green_lights = false
            OR step_12_customer_signature = false
          THEN 1
        END) as incomplete
      FROM qa_photo_reviews
      WHERE project != 'Marketing Activations'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY project, DATE(created_at AT TIME ZONE 'Africa/Johannesburg')
      ORDER BY date DESC, project ASC
    `;

    return {
      total: parseInt(stats.total, 10),
      incomplete: parseInt(stats.incomplete, 10),
      complete: parseInt(stats.complete, 10),
      averageFeedbackCount: parseFloat(stats.avgCompletedPhotos),
      totalFeedback: parseInt(stats.totalReviewed, 10),
      dailyStats: dailyStatsRows.map(row => ({
        project: row.project,
        date: row.date,
        total: parseInt(row.total, 10),
        complete: parseInt(row.complete, 10),
        incomplete: parseInt(row.incomplete, 10),
      })),
    };
  } catch (error) {
    log.error('Error calculating summary', { error }, 'waMonitorService.calculateSummary');
    throw new Error('Failed to calculate summary statistics');
  }
}

/**
 * Fast summary calculation for initial page load
 * Uses parallel queries and limits daily stats to last 7 days
 * Much faster than calculateSummary() for dashboard views
 */
export async function calculateSummaryFast(): Promise<WaMonitorSummary> {
  try {
    const sql = getDbConnection();

    // Run both queries in parallel for better performance
    const [statsResult, dailyStatsResult] = await Promise.all([
      // Basic counts - scan full table but simpler query
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN completed = true THEN 1 END) as complete,
          COUNT(CASE WHEN incomplete = true THEN 1 END) as incomplete_reviewed
        FROM qa_photo_reviews
        WHERE project != 'Marketing Activations'
      `,
      // Daily stats - last 7 days only for fast dashboard
      sql`
        SELECT
          COALESCE(project, 'Unknown') as project,
          TO_CHAR(DATE(created_at AT TIME ZONE 'Africa/Johannesburg'), 'YYYY-MM-DD') as date,
          COUNT(*) as total
        FROM qa_photo_reviews
        WHERE project != 'Marketing Activations'
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY project, DATE(created_at AT TIME ZONE 'Africa/Johannesburg')
        ORDER BY date DESC, project ASC
      `,
    ]);

    const stats = statsResult[0];
    const totalCount = parseInt(stats.total, 10);
    const completeCount = parseInt(stats.complete || '0', 10);

    return {
      total: totalCount,
      incomplete: totalCount - completeCount, // Simplified: everything not complete is incomplete
      complete: completeCount,
      averageFeedbackCount: 0, // Skip for fast load
      totalFeedback: parseInt(stats.incomplete_reviewed || '0', 10),
      dailyStats: dailyStatsResult.map(row => ({
        project: row.project,
        date: row.date,
        total: parseInt(row.total, 10),
        complete: 0, // Skip detailed stats for fast load
        incomplete: parseInt(row.total, 10), // Assume all incomplete for fast view
      })),
    };
  } catch (error) {
    log.error('Error calculating fast summary', { error }, 'waMonitorService.calculateSummaryFast');
    throw new Error('Failed to calculate summary statistics');
  }
}

/**
 * Get complete per-project statistics from ALL records
 * Unlike calculateSummaryFast(), this queries ALL records (not limited to 7 days)
 * and properly calculates complete vs incomplete status
 *
 * @param dateFrom Optional start date filter (YYYY-MM-DD format, SAST timezone)
 * @param dateTo Optional end date filter (YYYY-MM-DD format, SAST timezone)
 */
export async function getCompleteProjectStats(
  dateFrom?: string,
  dateTo?: string
): Promise<Array<{
  project: string;
  total: number;
  complete: number;
  incomplete: number;
}>> {
  const sql = getDbConnection();
  try {
    // Build date filter conditions
    // Use whatsapp_message_date if available, otherwise fall back to created_at
    let dateFilter = sql``;

    if (dateFrom && dateTo) {
      dateFilter = sql`AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') BETWEEN ${dateFrom}::date AND ${dateTo}::date`;
    } else if (dateFrom) {
      dateFilter = sql`AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateFrom}::date`;
    } else if (dateTo) {
      dateFilter = sql`AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') <= ${dateTo}::date`;
    }

    const results = await sql`
      SELECT
        COALESCE(project, 'Unknown') as project,
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true
            AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true
            AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true
            AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true
            AND step_08_ont_barcode = true
            AND step_09_ups_serial = true
            AND step_10_final_installation = true
            AND step_11_green_lights = true
            AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project != 'Marketing Activations'
        ${dateFilter}
      GROUP BY project
      ORDER BY total DESC
    `;

    return results.map(row => ({
      project: row.project,
      total: parseInt(row.total, 10),
      complete: parseInt(row.complete, 10),
      incomplete: parseInt(row.total, 10) - parseInt(row.complete, 10),
    }));
  } catch (error) {
    log.error('Error calculating complete project stats', { error, dateFrom, dateTo }, 'waMonitorService.getCompleteProjectStats');
    throw new Error('Failed to calculate project statistics');
  }
}

/**
 * Get daily drops count per project
 * Returns count of drops submitted today grouped by project
 * Uses whatsapp_message_date to reflect actual submission date, not database insert date
 */
export async function getDailyDropsPerProject(date?: string): Promise<Array<{ date: string; project: string; count: number }>> {
  const sql = getDbConnection();
  try {
    // If date provided, use it; otherwise use current date in SAST
    let targetDate: string;
    if (date) {
      targetDate = date;
    } else {
      // Get current date in SAST timezone
      const result = await sql`SELECT CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' as today`;
      targetDate = result[0].today;
    }

    const rows = await sql`
      SELECT
        TO_CHAR(DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg'), 'YYYY-MM-DD') as date,
        COALESCE(project, 'Unknown') as project,
        COUNT(DISTINCT drop_number) as count
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') = ${targetDate}::date
        AND project != 'Marketing Activations'
      GROUP BY DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg'), project
      ORDER BY project ASC
    `;

    return rows.map((row: any) => ({
      date: row.date,  // Now returns 'YYYY-MM-DD' string instead of timestamp
      project: row.project,
      count: parseInt(row.count, 10),
    }));
  } catch (error) {
    log.error('Error getting daily drops per project', { error, date }, 'waMonitorService.getDailyDropsPerProject');
    throw new Error('Failed to get daily drops per project');
  }
}

// ==================== HELPERS ====================

/**
 * Transform database row to QaReviewDrop object
 * Handles date parsing and type conversion
 * Maps qa_photo_reviews table to QaReviewDrop interface
 * Status is calculated from the 12 QA checklist steps
 */
function transformDbRowToDrop(row: any): QaReviewDrop {
  // Parse all 12 QA steps
  const step_01 = row.step_01_house_photo || false;
  const step_02 = row.step_02_cable_from_pole || false;
  const step_03 = row.step_03_cable_entry_outside || false;
  const step_04 = row.step_04_cable_entry_inside || false;
  const step_05 = row.step_05_wall_for_installation || false;
  const step_06 = row.step_06_ont_back_after_install || false;
  const step_07 = row.step_07_power_meter_reading || false;
  const step_08 = row.step_08_ont_barcode || false;
  const step_09 = row.step_09_ups_serial || false;
  const step_10 = row.step_10_final_installation || false;
  const step_11 = row.step_11_green_lights || false;
  const step_12 = row.step_12_customer_signature || false;

  // Calculate status: Complete = ALL 12 steps are true
  const allStepsComplete = step_01 && step_02 && step_03 && step_04 && step_05 && step_06 &&
                           step_07 && step_08 && step_09 && step_10 && step_11 && step_12;

  const status: 'incomplete' | 'complete' = allStepsComplete ? 'complete' : 'incomplete';

  // Use database values for completed/incomplete (tracks if QA reviewed it)
  // Don't calculate from steps - that would make all unreviewed drops appear incomplete
  const completed = row.completed || false;
  const incomplete = row.incomplete || false;

  return {
    id: row.id,
    dropNumber: row.dropNumber,
    status,
    reviewDate: new Date(row.reviewDate),
    userName: row.userName || '',
    completedPhotos: row.completedPhotos || 0,
    outstandingPhotos: row.outstandingPhotos || 12,
    outstandingPhotosLoadedTo1map: row.outstandingPhotosLoadedTo1map || false,
    comment: row.comment || null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    project: row.project || null,
    assignedAgent: row.assignedAgent || null,
    completed,
    incomplete,
    feedbackSent: row.feedbackSent ? new Date(row.feedbackSent) : null,
    senderPhone: row.senderPhone || null,
    resubmitted: row.resubmitted || false,
    lockedBy: row.lockedBy || null,
    lockedAt: row.lockedAt ? new Date(row.lockedAt) : null,
    incorrectSteps: row.incorrectSteps || [],
    incorrectComments: row.incorrectComments || {},
    // QA Steps (12 steps from WA Monitor)
    step_01_house_photo: step_01,
    step_02_cable_from_pole: step_02,
    step_03_cable_entry_outside: step_03,
    step_04_cable_entry_inside: step_04,
    step_05_wall_for_installation: step_05,
    step_06_ont_back_after_install: step_06,
    step_07_power_meter_reading: step_07,
    step_08_ont_barcode: step_08,
    step_09_ups_serial: step_09,
    step_10_final_installation: step_10,
    step_11_green_lights: step_11,
    step_12_customer_signature: step_12,
    // Serial scanning fields (Stage 3 - Stock Tracking)
    ontSerialScanned: row.ontSerialScanned || null,
    upsSerialScanned: row.upsSerialScanned || null,
    ontConsumptionId: row.ontConsumptionId || null,
    upsConsumptionId: row.upsConsumptionId || null,
    scanGpsLat: row.scanGpsLat ? parseFloat(row.scanGpsLat) : null,
    scanGpsLng: row.scanGpsLng ? parseFloat(row.scanGpsLng) : null,
    // OneMap serial data (fetched from 1Map by drop_number)
    onemapOntBarcode: row.onemapOntBarcode || null,
    onemapOntActivationCode: row.onemapOntActivationCode || null,
    onemapUpsSerial: row.onemapUpsSerial || null,
    onemapInstallerName: row.onemapInstallerName || null,
    onemapInstallationDate: row.onemapInstallationDate || null,
  };
}

/**
 * Get project stats by time period (real-time calculation)
 * Returns stats for today, this week, this month, and all-time
 */
export async function getProjectStats(projectName: string): Promise<{
  today: { total: number; complete: number; incomplete: number; completionRate: number };
  week: { total: number; complete: number; incomplete: number; completionRate: number };
  month: { total: number; complete: number; incomplete: number; completionRate: number };
  allTime: { total: number; complete: number; incomplete: number; completionRate: number };
}> {
  const sql = getDbConnection();
  try {
    // Get current date in SAST timezone
    const [dateInfo] = await sql`
      SELECT
        CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' as today,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '7 days')::date as week_start,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '30 days')::date as month_start
    `;

    // Today's stats
    const [todayStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project = ${projectName}
        AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') = ${dateInfo.today}::date
    `;

    // This week's stats
    const [weekStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project = ${projectName}
        AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateInfo.week_start}::date
    `;

    // This month's stats
    const [monthStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project = ${projectName}
        AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateInfo.month_start}::date
    `;

    // All-time stats
    const [allTimeStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project = ${projectName}
    `;

    // Helper to calculate stats
    const calcStats = (total: number, complete: number) => ({
      total: parseInt(total as any, 10) || 0,
      complete: parseInt(complete as any, 10) || 0,
      incomplete: (parseInt(total as any, 10) || 0) - (parseInt(complete as any, 10) || 0),
      completionRate: total > 0 ? Math.round((complete / total) * 100) : 0,
    });

    return {
      today: calcStats(todayStats.total, todayStats.complete),
      week: calcStats(weekStats.total, weekStats.complete),
      month: calcStats(monthStats.total, monthStats.complete),
      allTime: calcStats(allTimeStats.total, allTimeStats.complete),
    };
  } catch (error) {
    log.error('Error getting project stats', { error, projectName }, 'waMonitorService.getProjectStats');
    throw new Error('Failed to get project stats');
  }
}

/**
 * Get all projects stats summary (for Projects page overview)
 * Returns stats for all projects combined + comprehensive metrics
 * Supports optional date range filtering
 * @param startDate - Optional start date (YYYY-MM-DD format), defaults to today
 * @param endDate - Optional end date (YYYY-MM-DD format), defaults to today
 */
export async function getAllProjectsStatsSummary(
  startDate?: string,
  endDate?: string
): Promise<{
  total: number;
  complete: number;
  incomplete: number;
  completionRate: number;
  byProject: Array<{
    project: string;
    total: number;
    complete: number;
    completionRate: number;
    overallTotal: number;
    overallComplete: number;
    overallCompletionRate: number;
  }>;
  overallStats: {
    totalInSystem: number;
    completedInSystem: number;
    systemCompletionRate: number;
  };
  trends: {
    weekly: { total: number; complete: number; completionRate: number };
    monthly: { total: number; complete: number; completionRate: number };
  };
  outstanding: {
    totalIncomplete: number;
    needsAttention: number;
    recent: number;
  };
  resubmissions: {
    total: number;
    rate: number;
    firstTimePassRate: number;
  };
  commonFailures: Array<{ step: string; count: number; percentage: number }>;
  feedbackStats: {
    sent: number;
    pending: number;
    sendRate: number;
  };
  agentPerformance: Array<{ agent: string; drops: number; completionRate: number }>;
}> {
  const sql = getDbConnection();
  try {
    // Get current date in SAST timezone
    const [dateInfo] = await sql`
      SELECT
        CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' as today,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '7 days')::date as week_ago,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '30 days')::date as month_ago
    `;

    // Determine date range for main query
    const queryStartDate = startDate || dateInfo.today;
    const queryEndDate = endDate || dateInfo.today;

    // 1. Stats by project for the selected date range
    const projectStats = await sql`
      SELECT
        COALESCE(project, 'Unknown') as project,
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')
        BETWEEN ${queryStartDate}::date AND ${queryEndDate}::date
        AND project != 'Marketing Activations'
      GROUP BY project
      ORDER BY total DESC
    `;

    // 2. Overall system stats (all-time by project)
    const overallProjectStats = await sql`
      SELECT
        COALESCE(project, 'Unknown') as project,
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project != 'Marketing Activations'
      GROUP BY project
    `;

    // 3. Weekly trends
    const [weeklyStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateInfo.week_ago}::date
    `;

    // 4. Monthly trends
    const [monthlyStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateInfo.month_ago}::date
    `;

    // 5. Outstanding drops
    const [outstandingStats] = await sql`
      SELECT
        COUNT(DISTINCT CASE
          WHEN NOT (
            step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          )
          THEN drop_number
        END) as total_incomplete,
        COUNT(DISTINCT CASE
          WHEN NOT (
            step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          )
          AND COALESCE(whatsapp_message_date, created_at) < NOW() - INTERVAL '7 days'
          THEN drop_number
        END) as needs_attention
      FROM qa_photo_reviews
    `;

    // 6. Resubmission stats
    const [resubmissionStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total_drops,
        COUNT(DISTINCT CASE WHEN resubmitted = true THEN drop_number END) as resubmitted_drops
      FROM qa_photo_reviews
    `;

    // 7. Common failure points
    const [failureStats] = await sql`
      SELECT
        COUNT(CASE WHEN step_01_house_photo = false THEN 1 END) as step_01_fails,
        COUNT(CASE WHEN step_02_cable_from_pole = false THEN 1 END) as step_02_fails,
        COUNT(CASE WHEN step_03_cable_entry_outside = false THEN 1 END) as step_03_fails,
        COUNT(CASE WHEN step_04_cable_entry_inside = false THEN 1 END) as step_04_fails,
        COUNT(CASE WHEN step_05_wall_for_installation = false THEN 1 END) as step_05_fails,
        COUNT(CASE WHEN step_06_ont_back_after_install = false THEN 1 END) as step_06_fails,
        COUNT(CASE WHEN step_07_power_meter_reading = false THEN 1 END) as step_07_fails,
        COUNT(CASE WHEN step_08_ont_barcode = false THEN 1 END) as step_08_fails,
        COUNT(CASE WHEN step_09_ups_serial = false THEN 1 END) as step_09_fails,
        COUNT(CASE WHEN step_10_final_installation = false THEN 1 END) as step_10_fails,
        COUNT(CASE WHEN step_11_green_lights = false THEN 1 END) as step_11_fails,
        COUNT(CASE WHEN step_12_customer_signature = false THEN 1 END) as step_12_fails,
        COUNT(*) as total_drops
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')
        BETWEEN ${queryStartDate}::date AND ${queryEndDate}::date
    `;

    // 8. Feedback stats
    const [feedbackStats] = await sql`
      SELECT
        COUNT(DISTINCT CASE WHEN feedback_sent IS NOT NULL THEN drop_number END) as sent,
        COUNT(DISTINCT CASE
          WHEN feedback_sent IS NULL
          AND NOT (
            step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          )
          THEN drop_number
        END) as pending
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')
        BETWEEN ${queryStartDate}::date AND ${queryEndDate}::date
    `;

    // 9. Agent performance for the selected date range
    const agentStats = await sql`
      SELECT
        COALESCE(assigned_agent, 'Unassigned') as agent,
        COUNT(DISTINCT drop_number) as drops,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')
        BETWEEN ${queryStartDate}::date AND ${queryEndDate}::date
        AND assigned_agent IS NOT NULL
      GROUP BY assigned_agent
      ORDER BY complete DESC, drops DESC
      LIMIT 10
    `;

    // Calculate totals
    const todayTotal = projectStats.reduce((sum, p) => sum + parseInt(p.total as any, 10), 0);
    const todayComplete = projectStats.reduce((sum, p) => sum + parseInt(p.complete as any, 10), 0);

    const overallTotal = overallProjectStats.reduce((sum, p) => sum + parseInt(p.total as any, 10), 0);
    const overallComplete = overallProjectStats.reduce((sum, p) => sum + parseInt(p.complete as any, 10), 0);

    // Process common failures
    const stepLabels: { [key: string]: string } = {
      step_01_fails: 'House photo',
      step_02_fails: 'Cable from pole',
      step_03_fails: 'Cable entry outside',
      step_04_fails: 'Cable entry inside',
      step_05_fails: 'Wall for installation',
      step_06_fails: 'ONT back after install',
      step_07_fails: 'Power meter reading',
      step_08_fails: 'ONT barcode',
      step_09_fails: 'UPS serial',
      step_10_fails: 'Final installation',
      step_11_fails: 'Green lights',
      step_12_fails: 'Customer signature',
    };

    const failures = Object.entries(stepLabels)
      .map(([key, label]) => ({
        step: label,
        count: parseInt((failureStats as any)[key], 10) || 0,
        percentage: failureStats.total_drops > 0
          ? Math.round((parseInt((failureStats as any)[key], 10) / parseInt(failureStats.total_drops, 10)) * 100)
          : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Build overall stats map
    const overallMap = new Map(
      overallProjectStats.map(p => [p.project, {
        total: parseInt(p.total as any, 10),
        complete: parseInt(p.complete as any, 10),
      }])
    );

    const totalResubmitted = parseInt(resubmissionStats.resubmitted_drops as any, 10) || 0;
    const totalDropsForResubmission = parseInt(resubmissionStats.total_drops as any, 10) || 0;

    return {
      total: todayTotal,
      complete: todayComplete,
      incomplete: todayTotal - todayComplete,
      completionRate: todayTotal > 0 ? Math.round((todayComplete / todayTotal) * 100) : 0,
      byProject: projectStats.map(p => {
        const overall = overallMap.get(p.project) || { total: 0, complete: 0 };
        return {
          project: p.project,
          total: parseInt(p.total as any, 10),
          complete: parseInt(p.complete as any, 10),
          completionRate: p.total > 0 ? Math.round((parseInt(p.complete as any, 10) / parseInt(p.total as any, 10)) * 100) : 0,
          overallTotal: overall.total,
          overallComplete: overall.complete,
          overallCompletionRate: overall.total > 0 ? Math.round((overall.complete / overall.total) * 100) : 0,
        };
      }),
      overallStats: {
        totalInSystem: overallTotal,
        completedInSystem: overallComplete,
        systemCompletionRate: overallTotal > 0 ? Math.round((overallComplete / overallTotal) * 100) : 0,
      },
      trends: {
        weekly: {
          total: parseInt(weeklyStats.total as any, 10) || 0,
          complete: parseInt(weeklyStats.complete as any, 10) || 0,
          completionRate: weeklyStats.total > 0
            ? Math.round((parseInt(weeklyStats.complete as any, 10) / parseInt(weeklyStats.total as any, 10)) * 100)
            : 0,
        },
        monthly: {
          total: parseInt(monthlyStats.total as any, 10) || 0,
          complete: parseInt(monthlyStats.complete as any, 10) || 0,
          completionRate: monthlyStats.total > 0
            ? Math.round((parseInt(monthlyStats.complete as any, 10) / parseInt(monthlyStats.total as any, 10)) * 100)
            : 0,
        },
      },
      outstanding: {
        totalIncomplete: parseInt(outstandingStats.total_incomplete as any, 10) || 0,
        needsAttention: parseInt(outstandingStats.needs_attention as any, 10) || 0,
        recent: (parseInt(outstandingStats.total_incomplete as any, 10) || 0) - (parseInt(outstandingStats.needs_attention as any, 10) || 0),
      },
      resubmissions: {
        total: totalResubmitted,
        rate: totalDropsForResubmission > 0 ? Math.round((totalResubmitted / totalDropsForResubmission) * 100) : 0,
        firstTimePassRate: totalDropsForResubmission > 0
          ? Math.round(((totalDropsForResubmission - totalResubmitted) / totalDropsForResubmission) * 100)
          : 100,
      },
      commonFailures: failures,
      feedbackStats: {
        sent: parseInt(feedbackStats.sent as any, 10) || 0,
        pending: parseInt(feedbackStats.pending as any, 10) || 0,
        sendRate: (parseInt(feedbackStats.sent as any, 10) + parseInt(feedbackStats.pending as any, 10)) > 0
          ? Math.round((parseInt(feedbackStats.sent as any, 10) / (parseInt(feedbackStats.sent as any, 10) + parseInt(feedbackStats.pending as any, 10))) * 100)
          : 0,
      },
      agentPerformance: agentStats.map(a => ({
        agent: a.agent,
        drops: parseInt(a.drops as any, 10),
        completionRate: a.drops > 0 ? Math.round((parseInt(a.complete as any, 10) / parseInt(a.drops as any, 10)) * 100) : 0,
      })),
    };
  } catch (error) {
    log.error('Error getting all projects stats summary', { error, startDate, endDate }, 'waMonitorService.getAllProjectsStatsSummary');
    throw new Error('Failed to get all projects stats summary');
  }
}

/**
 * Validate database connection
 */
export async function validateConnection(): Promise<boolean> {
  try {
    const sql = getDbConnection();
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    log.error('Database connection failed', { error }, 'waMonitorService.validateConnection');
    return false;
  }
}
