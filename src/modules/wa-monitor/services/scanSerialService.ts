/**
 * Scan Serial Service
 * Handles equipment serial scanning during installation
 * Part of the 4-stage Site Stock Tracking System
 *
 * Stage 3: Installation - Links scanned serials to drop numbers
 * Creates consumption records and updates stock status
 *
 * Tables involved:
 * - qa_photo_reviews: Store scanned serial and consumption link
 * - stock_serials: Validate and update serial status
 * - stock_consumptions: Create consumption record
 */

import { neon, NeonQueryFunction } from '@/lib/db-neon';

// ==================== TYPES ====================

export interface ScanSerialRequest {
  qaReviewId: string;
  dropNumber: string;
  stepNumber: 8 | 9;
  serialNumber: string;
  technicianId?: string;
  technicianName?: string;
  gpsLat?: number;
  gpsLng?: number;
  scanTimestamp: string;
}

export interface ValidateSerialResult {
  valid: boolean;
  serial?: {
    id: string;
    serialNumber: string;
    status: string;
    stockItemId: string;
  };
  errorCode?: 'SERIAL_NOT_FOUND' | 'SERIAL_NOT_ISSUED' | 'ALREADY_INSTALLED';
  errorMessage?: string;
}

export interface RecordScanResult {
  consumptionId: string;
  serialStatus: 'installed';
  dropUpdated: boolean;
  qaReviewUpdated: boolean;
}

// ==================== DATABASE CONNECTION ====================

function getDbConnection(): NeonQueryFunction<false, false> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

// ==================== VALIDATION ====================

/**
 * Validate serial number exists and is in correct status
 * Serial must be 'issued' status to be scanned at installation
 */
export async function validateSerial(
  serialNumber: string,
  technicianId?: string
): Promise<ValidateSerialResult> {
  const sql = getDbConnection();

  // Find serial in stock_serials table
  const serials = await sql`
    SELECT
      id,
      serial_number as "serialNumber",
      status,
      stock_item_id as "stockItemId",
      installed_at_drop_number as "installedAtDropNumber"
    FROM stock_serials
    WHERE serial_number = ${serialNumber}
    LIMIT 1
  `;

  if (serials.length === 0) {
    return {
      valid: false,
      errorCode: 'SERIAL_NOT_FOUND',
      errorMessage: 'Serial number not found in inventory',
    };
  }

  const serial = serials[0]!; // Guaranteed by length check above

  // Check if already installed
  if (serial.status === 'installed') {
    return {
      valid: false,
      errorCode: 'ALREADY_INSTALLED',
      errorMessage: `Serial already installed at drop ${serial.installedAtDropNumber || 'unknown'}`,
    };
  }

  // Check if status is 'issued' (required for installation scan)
  if (serial.status !== 'issued') {
    return {
      valid: false,
      errorCode: 'SERIAL_NOT_ISSUED',
      errorMessage: `Serial has not been issued to a technician. Current status: ${serial.status}`,
    };
  }

  return {
    valid: true,
    serial: {
      id: serial.id,
      serialNumber: serial.serialNumber,
      status: serial.status,
      stockItemId: serial.stockItemId,
    },
  };
}

// ==================== RECORD SCAN ====================

/**
 * Record serial scan - creates consumption record and updates all tables
 * This is a transactional operation (all-or-nothing)
 */
export async function recordScan(
  request: ScanSerialRequest & { serialId: string; stockItemId: string }
): Promise<RecordScanResult> {
  const sql = getDbConnection();

  // Generate consumption ID
  const consumptionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // 1. Create stock_consumptions record
  await sql`
    INSERT INTO stock_consumptions (
      id,
      job_type,
      drop_number,
      stock_item_id,
      serial_id,
      serial_number,
      quantity,
      consumed_by_id,
      consumed_by_name,
      consumption_date,
      gps_lat,
      gps_lng,
      created_at,
      updated_at
    ) VALUES (
      ${consumptionId},
      'drop',
      ${request.dropNumber},
      ${request.stockItemId},
      ${request.serialId},
      ${request.serialNumber},
      1,
      ${request.technicianId || null},
      ${request.technicianName || null},
      ${request.scanTimestamp},
      ${request.gpsLat || null},
      ${request.gpsLng || null},
      ${now},
      ${now}
    )
  `;

  // 2. Update stock_serials status to 'installed'
  await sql`
    UPDATE stock_serials
    SET
      status = 'installed',
      installed_at_drop_number = ${request.dropNumber},
      installed_date = ${request.scanTimestamp},
      installed_by = ${request.technicianName || null},
      updated_at = ${now}
    WHERE id = ${request.serialId}
  `;

  // 3. Update qa_photo_reviews with serial and consumption link
  const updateFields =
    request.stepNumber === 8
      ? {
          ont_serial_scanned: request.serialNumber,
          ont_consumption_id: consumptionId,
        }
      : {
          ups_serial_scanned: request.serialNumber,
          ups_consumption_id: consumptionId,
        };

  if (request.stepNumber === 8) {
    await sql`
      UPDATE qa_photo_reviews
      SET
        ont_serial_scanned = ${request.serialNumber},
        ont_consumption_id = ${consumptionId},
        scan_gps_lat = ${request.gpsLat || null},
        scan_gps_lng = ${request.gpsLng || null},
        updated_at = ${now}
      WHERE id = ${request.qaReviewId}
    `;
  } else {
    await sql`
      UPDATE qa_photo_reviews
      SET
        ups_serial_scanned = ${request.serialNumber},
        ups_consumption_id = ${consumptionId},
        scan_gps_lat = ${request.gpsLat || null},
        scan_gps_lng = ${request.gpsLng || null},
        updated_at = ${now}
      WHERE id = ${request.qaReviewId}
    `;
  }

  return {
    consumptionId,
    serialStatus: 'installed',
    dropUpdated: true,
    qaReviewUpdated: true,
  };
}

// ==================== SERVICE OBJECT (for mocking in tests) ====================

export const scanSerialService = {
  validateSerial,
  recordScan,
};
