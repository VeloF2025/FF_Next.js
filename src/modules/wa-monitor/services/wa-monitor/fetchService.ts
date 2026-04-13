/**
 * WA Monitor Fetch Operations
 */

import { log } from '@/lib/logger';
import type { QaReviewDrop } from '../../types/wa-monitor.types';
import { getDbConnection, transformDbRowToDrop, type QaReviewDbRow } from './_shared';

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

    return (rows as QaReviewDbRow[]).map(transformDbRowToDrop);
  } catch (error) {
    log.error('Error fetching all drops', { error }, 'waMonitorService.getAllDrops');
    throw new Error('Failed to fetch QA review drops');
  }
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
      const countRows = await sql`
        SELECT COUNT(*) as count
        FROM qa_photo_reviews q
        WHERE q.project != 'Marketing Activations'
          AND (LOWER(q.drop_number) LIKE ${searchPattern} OR LOWER(q.project) LIKE ${searchPattern})
      `;
      totalCount = parseInt(countRows[0]!.count, 10);
    } else {
      const countRows = await sql`
        SELECT COUNT(*) as count
        FROM qa_photo_reviews q
        WHERE q.project != 'Marketing Activations'
      `;
      totalCount = parseInt(countRows[0]!.count, 10);
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
      drops: (rows as QaReviewDbRow[]).map(transformDbRowToDrop),
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

    return row ? transformDbRowToDrop(row as QaReviewDbRow) : null;
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

    return (rows as QaReviewDbRow[]).map(transformDbRowToDrop);
  } catch (error) {
    log.error('Error fetching drops by status', { error, status }, 'waMonitorService.getDropsByStatus');
    throw new Error('Failed to fetch QA review drops by status');
  }
}
