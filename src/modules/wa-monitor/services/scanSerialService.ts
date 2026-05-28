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
 *
 * Sprint E Track 2.6: stock_serials.status is now written via promoteSerial()
 * (issued → installed, matrix row 69 `installed_at_drop`). This replaces the
 * direct UPDATE that predated the lifecycle state machine.
 */

import { pool } from '@/lib/db-pool';
import { promoteSerial } from '@/modules/procurement/field-stock/services/serialLifecycle';
import { log } from '@/lib/logger';

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

// ==================== VALIDATION ====================

/**
 * Validate serial number exists and is in correct status.
 * Serial must be 'issued' status to be scanned at installation.
 */
export async function validateSerial(
  serialNumber: string,
  _technicianId?: string,
): Promise<ValidateSerialResult> {
  type Row = {
    id: string;
    serialNumber: string;
    status: string;
    stockItemId: string;
    installedAtDropNumber: string | null;
  };

  const result = await pool.query<Row>(
    `SELECT id,
            serial_number            AS "serialNumber",
            status,
            stock_item_id            AS "stockItemId",
            installed_at_drop_number AS "installedAtDropNumber"
       FROM stock_serials
      WHERE serial_number = $1
      LIMIT 1`,
    [serialNumber],
  );

  if (result.rows.length === 0) {
    return {
      valid: false,
      errorCode: 'SERIAL_NOT_FOUND',
      errorMessage: 'Serial number not found in inventory',
    };
  }

  const serial = result.rows[0]!;

  if (serial.status === 'installed') {
    return {
      valid: false,
      errorCode: 'ALREADY_INSTALLED',
      errorMessage: `Serial already installed at drop ${serial.installedAtDropNumber ?? 'unknown'}`,
    };
  }

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
 * Record serial scan — creates consumption record and updates all tables.
 *
 * All four writes run inside a single pg transaction:
 *   1. INSERT stock_consumptions
 *   2. promoteSerial(issued → installed) via mig 387 matrix row 69 `installed_at_drop`
 *   3. UPDATE stock_serials metadata (installed_at_drop_number / installed_date / installed_by)
 *   4. UPDATE qa_photo_reviews with serial + consumption link
 *
 * Sprint E Track 2.6: step 2 replaces the former direct
 * `UPDATE stock_serials SET status = 'installed'` (matrix row 69,
 * transition `issued → installed`). promoteSerial passes the PoolClient
 * to stay inside the single transaction (caller owns BEGIN/COMMIT).
 */
export async function recordScan(
  request: ScanSerialRequest & { serialId: string; stockItemId: string },
): Promise<RecordScanResult> {
  const consumptionId = crypto.randomUUID();
  const now = new Date().toISOString();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert consumption record.
    // `updated_at` is not included: the stock_consumptions schema (sprint-e-seed.sql
    // and the production migration 384 CREATE TABLE) does not define that column.
    // created_at is sufficient for insert-only audit on consumption records.
    await client.query(
      `INSERT INTO stock_consumptions (
         id, job_type, drop_number, stock_item_id, serial_id, serial_number,
         quantity, consumed_by_id, consumed_by_name, consumption_date,
         gps_lat, gps_lng, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        consumptionId,
        'drop',
        request.dropNumber,
        request.stockItemId,
        request.serialId,
        request.serialNumber,
        1,
        request.technicianId ?? null,
        request.technicianName ?? null,
        request.scanTimestamp,
        request.gpsLat ?? null,
        request.gpsLng ?? null,
        now,
      ],
    );

    // 2. Promote serial issued → installed via the lifecycle state machine.
    //    Matrix row 69 (`installed_at_drop`). PoolClient path — this transaction
    //    owns BEGIN/COMMIT; promoteSerial detects `release` on the PoolClient
    //    and skips its own transaction wrapper.
    //    toHolderId: null — installed serials have no tracked holder.
    await promoteSerial(client, {
      serialId:    request.serialId,
      toStatus:    'installed',
      toHolderId:  null,
      sourceTable: 'stock_consumptions',
      sourceId:    consumptionId,
      actorUserId: request.technicianId ?? null,
      payload: {
        drop_number: request.dropNumber,
        scanned_via: 'wa_install_scan',
      },
    });

    // 3. Write install metadata columns (not touching status — already set by step 2).
    await client.query(
      `UPDATE stock_serials
          SET installed_at_drop_number = $1,
              installed_date           = $2,
              installed_by             = $3,
              updated_at               = NOW()
        WHERE id = $4`,
      [
        request.dropNumber,
        request.scanTimestamp,
        request.technicianName ?? null,
        request.serialId,
      ],
    );

    // 4. Update qa_photo_reviews with serial + consumption link.
    if (request.stepNumber === 8) {
      await client.query(
        `UPDATE qa_photo_reviews
            SET ont_serial_scanned = $1,
                ont_consumption_id = $2,
                scan_gps_lat       = $3,
                scan_gps_lng       = $4,
                updated_at         = NOW()
          WHERE id = $5`,
        [
          request.serialNumber,
          consumptionId,
          request.gpsLat ?? null,
          request.gpsLng ?? null,
          request.qaReviewId,
        ],
      );
    } else {
      await client.query(
        `UPDATE qa_photo_reviews
            SET ups_serial_scanned = $1,
                ups_consumption_id = $2,
                scan_gps_lat       = $3,
                scan_gps_lng       = $4,
                updated_at         = NOW()
          WHERE id = $5`,
        [
          request.serialNumber,
          consumptionId,
          request.gpsLat ?? null,
          request.gpsLng ?? null,
          request.qaReviewId,
        ],
      );
    }

    await client.query('COMMIT');

    log.info(
      `WA install scan: serial ${request.serialNumber} promoted issued→installed at drop ${request.dropNumber}`,
      { serialId: request.serialId, consumptionId },
      'scanSerialService',
    );

    return {
      consumptionId,
      serialStatus: 'installed',
      dropUpdated: true,
      qaReviewUpdated: true,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch((rbErr: unknown) => {
      log.warn('scanSerialService ROLLBACK failed', { err: rbErr }, 'scanSerialService');
    });
    log.error(
      'scanSerialService recordScan failed',
      { error: err instanceof Error ? err.message : String(err) },
      'scanSerialService',
    );
    throw err;
  } finally {
    client.release();
  }
}

// ==================== SERVICE OBJECT (for mocking in tests) ====================

export const scanSerialService = {
  validateSerial,
  recordScan,
};
