/**
 * Consumption Service
 * Records material consumption on jobs (drops/installs)
 * THE KEY SERVICE FOR TRACEABILITY
 */

import { sql as poolSql, transaction } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { query } from './db';
import { postConsumeFromHolderWith } from './custodyService';
import type {
  StockConsumption,
  RecordConsumptionInput,
  ConsumptionFilters,
} from '../types';
import { validateSerialForConsumption } from './serialService';

// SQL for serial install with holder clearance (inlined in txn)
const SQL_INSTALL_SERIAL =
  `UPDATE stock_serials ` +
  `SET status = 'installed', holder_id = NULL, ` +
  `installed_at_drop_id = $2, installed_at_drop_number = $3, ` +
  `installed_date = NOW(), installed_by = $4, updated_at = NOW() ` +
  `WHERE id = $1`;

// SQL for stock_consumptions INSERT
const SQL_INSERT_CONSUMPTION =
  `INSERT INTO stock_consumptions (
    job_type, drop_id, drop_number, home_install_id,
    stock_item_id, item_code, item_name, quantity, uom,
    serial_id, serial_number, consumed_by_id, consumed_by_name,
    consumed_from_location_id, holder_id, gps_lat, gps_lng, notes
  ) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8, $9,
    $10, $11, $12, $13,
    $14, $15, $16, $17, $18
  ) RETURNING
    id,
    job_type               AS "jobType",
    drop_id                AS "dropId",
    drop_number            AS "dropNumber",
    home_install_id        AS "homeInstallId",
    stock_item_id          AS "stockItemId",
    item_code              AS "itemCode",
    item_name              AS "itemName",
    quantity,
    uom,
    serial_id              AS "serialId",
    serial_number          AS "serialNumber",
    consumed_by_id         AS "consumedById",
    consumed_by_name       AS "consumedByName",
    consumed_from_location_id AS "consumedFromLocationId",
    holder_id              AS "holderId",
    consumption_date       AS "consumptionDate",
    gps_lat                AS "gpsLat",
    gps_lng                AS "gpsLng",
    verified,
    notes,
    created_at             AS "createdAt"`;

/**
 * Record material consumption on a job.
 *
 * All writes execute inside a single pg.Pool transaction:
 *   1. INSERT stock_consumptions  (with holder_id)
 *   2. UPDATE drops with serial info (if applicable)
 *   3. UPDATE stock_serials — status=installed, holder_id=NULL (if serial present)
 *   4. postConsumeFromHolderWith — debits stock_custody + inserts field_stock_movements
 *
 * holderId resolution order:
 *   a) input.holderId (explicit)
 *   b) lookup stock_holders WHERE staff_id = consumedById (if consumedById provided)
 *   c) null — non-holder consumption (non-serialised bulk items, no custody debit)
 */
export async function recordConsumption(
  input: RecordConsumptionInput
): Promise<StockConsumption> {
  try {
    // ── Read-only pre-flight (outside txn) ──────────────────────────────────

    const itemRows = await poolSql`
      SELECT item_code, name, uom FROM stock_items WHERE id = ${input.stockItemId}
    `;
    if (itemRows.length === 0 || !itemRows[0]) {
      throw new Error(`Stock item ${input.stockItemId} not found`);
    }
    const item = itemRows[0];
    const itemCode  = item.item_code  as string;
    const itemName  = item.name       as string;
    const itemUom   = item.uom        as string;

    // Serial validation (read-only; outside txn)
    if (input.serialId && input.serialNumber) {
      const validation = await validateSerialForConsumption(
        input.serialNumber,
        input.consumedFromLocationId
      );
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    // Resolve holder (read-only; outside txn)
    let holderId: string | null = input.holderId ?? null;
    if (!holderId && input.consumedById) {
      const holderRow = await poolSql`
        SELECT id FROM stock_holders
        WHERE holder_type = 'staff' AND staff_id = ${input.consumedById}
        LIMIT 1
      `;
      holderId = (holderRow[0]?.id as string) ?? null;
    }

    // ── All writes in one ACID transaction ───────────────────────────────────

    const consumption = await transaction(async (txn) => {
      // 1. Insert consumption record
      const rows = await txn.query(SQL_INSERT_CONSUMPTION, [
        input.jobType,                        // $1
        input.dropId         ?? null,         // $2
        input.dropNumber     ?? null,         // $3
        input.homeInstallId  ?? null,         // $4
        input.stockItemId,                    // $5
        itemCode,                             // $6
        itemName,                             // $7
        input.quantity,                       // $8
        itemUom,                              // $9
        input.serialId       ?? null,         // $10
        input.serialNumber   ?? null,         // $11
        input.consumedById   ?? null,         // $12
        input.consumedByName ?? null,         // $13
        input.consumedFromLocationId,         // $14
        holderId,                             // $15
        input.gpsLat         ?? null,         // $16
        input.gpsLng         ?? null,         // $17
        input.notes          ?? null,         // $18
      ]);
      const record = rows[0] as unknown as StockConsumption;

      // 2. Update drops table with serial info
      if (input.dropNumber && input.serialNumber) {
        const [dropSql, dropParams] = buildDropSerialUpdate(input.dropNumber, input.serialNumber, itemCode);
        await txn.query(dropSql, dropParams);
      }

      // 3. Mark serial installed + clear holder (inlined to stay in txn)
      if (input.serialId && input.dropId && input.dropNumber) {
        await txn.query(SQL_INSTALL_SERIAL, [
          input.serialId,
          input.dropId,
          input.dropNumber,
          input.consumedByName ?? 'Unknown',
        ]);
        log.info(
          `Serial ${input.serialId} installed at drop ${input.dropNumber} (holder cleared)`,
          undefined,
          'consumptionService'
        );
      }

      // 4. Debit holder custody + insert consumption movement
      if (holderId) {
        await postConsumeFromHolderWith(txn, {
          stockItemId: input.stockItemId,
          quantity:    input.quantity,
          lotNumber:   null,
          unitCost:    null,
          fromHolderId: holderId,
          reference:   input.dropNumber ?? input.homeInstallId ?? undefined,
          performedBy: input.consumedByName ?? undefined,
        });
      }

      return record;
    });

    log.info(
      `Recorded consumption: ${input.serialNumber ?? `${input.quantity} x ${itemCode}`} for ${input.dropNumber}`,
      undefined,
      'consumptionService'
    );

    return consumption;
  } catch (error) {
    log.error('Failed to record consumption', { error }, 'consumptionService');
    throw error;
  }
}

/**
 * Build the parameterized query args for updating the drops table with a serial.
 * Returns a [text, params] tuple suitable for txn.query(...spread).
 */
function buildDropSerialUpdate(
  dropNumber: string,
  serialNumber: string,
  itemCode: string
): [string, unknown[]] {
  const code = itemCode.toLowerCase();
  if (code.includes('ont')) {
    return [
      `UPDATE drops SET ont_serial = $1, materials_issued = true, updated_at = NOW() WHERE dr_number = $2`,
      [serialNumber, dropNumber],
    ];
  }
  if (code.includes('ups') || code.includes('gizzu')) {
    return [
      `UPDATE drops SET mini_ups_serial = $1, materials_issued = true, updated_at = NOW() WHERE dr_number = $2`,
      [serialNumber, dropNumber],
    ];
  }
  if (code.includes('router')) {
    return [
      `UPDATE drops SET router_serial = $1, materials_issued = true, updated_at = NOW() WHERE dr_number = $2`,
      [serialNumber, dropNumber],
    ];
  }
  // Unknown item type — no column to update; return a no-op SELECT 1
  return [`SELECT 1`, []];
}

/**
 * Get consumptions with filters
 */
export async function getConsumptions(
  filters?: ConsumptionFilters
): Promise<StockConsumption[]> {
  try {
    let queryText = `
      SELECT
        c.id,
        c.job_type as "jobType",
        c.drop_id as "dropId",
        c.drop_number as "dropNumber",
        c.home_install_id as "homeInstallId",
        c.stock_item_id as "stockItemId",
        c.item_code as "itemCode",
        c.item_name as "itemName",
        c.quantity,
        c.uom,
        c.serial_id as "serialId",
        c.serial_number as "serialNumber",
        c.consumed_by_id as "consumedById",
        c.consumed_by_name as "consumedByName",
        c.consumed_from_location_id as "consumedFromLocationId",
        c.consumption_date as "consumptionDate",
        c.gps_lat as "gpsLat",
        c.gps_lng as "gpsLng",
        c.verified,
        c.verified_by as "verifiedBy",
        c.verified_at as "verifiedAt",
        c.notes,
        c.created_at as "createdAt"
      FROM stock_consumptions c
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.jobType) {
      queryText += ` AND c.job_type = $${paramIndex++}`;
      params.push(filters.jobType);
    }

    if (filters?.dropNumber) {
      queryText += ` AND c.drop_number = $${paramIndex++}`;
      params.push(filters.dropNumber);
    }

    if (filters?.technicianId) {
      queryText += ` AND c.consumed_by_id = $${paramIndex++}`;
      params.push(filters.technicianId);
    }

    if (filters?.verified !== undefined) {
      queryText += ` AND c.verified = $${paramIndex++}`;
      params.push(filters.verified);
    }

    if (filters?.dateFrom) {
      queryText += ` AND c.consumption_date >= $${paramIndex++}`;
      params.push(filters.dateFrom);
    }

    if (filters?.dateTo) {
      queryText += ` AND c.consumption_date <= $${paramIndex++}`;
      params.push(filters.dateTo);
    }

    queryText += ' ORDER BY c.consumption_date DESC';

    const results = await query<StockConsumption>(queryText, params);
    return results;
  } catch (error) {
    log.error('Failed to get consumptions', { error }, 'consumptionService');
    throw error;
  }
}

/**
 * Get all consumptions for a specific drop
 */
export async function getConsumptionsByDrop(dropNumber: string): Promise<StockConsumption[]> {
  try {
    const results = await poolSql`
      SELECT
        c.id,
        c.job_type as "jobType",
        c.drop_id as "dropId",
        c.drop_number as "dropNumber",
        c.stock_item_id as "stockItemId",
        c.item_code as "itemCode",
        c.item_name as "itemName",
        c.quantity,
        c.uom,
        c.serial_id as "serialId",
        c.serial_number as "serialNumber",
        c.consumed_by_name as "consumedByName",
        c.consumption_date as "consumptionDate",
        c.verified,
        c.notes
      FROM stock_consumptions c
      WHERE c.drop_number = ${dropNumber}
      ORDER BY c.consumption_date DESC
    `;

    return results as unknown as StockConsumption[];
  } catch (error) {
    log.error('Failed to get consumptions by drop', { error }, 'consumptionService');
    throw error;
  }
}

/**
 * Get consumptions by technician
 */
export async function getConsumptionsByTechnician(
  technicianId: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<StockConsumption[]> {
  try {
    let queryText = `
      SELECT
        c.id,
        c.job_type as "jobType",
        c.drop_number as "dropNumber",
        c.item_code as "itemCode",
        c.item_name as "itemName",
        c.quantity,
        c.uom,
        c.serial_number as "serialNumber",
        c.consumption_date as "consumptionDate",
        c.verified
      FROM stock_consumptions c
      WHERE c.consumed_by_id = $1
    `;

    const params: unknown[] = [technicianId];
    let paramIndex = 2;

    if (dateFrom) {
      queryText += ` AND c.consumption_date >= $${paramIndex++}`;
      params.push(dateFrom);
    }

    if (dateTo) {
      queryText += ` AND c.consumption_date <= $${paramIndex++}`;
      params.push(dateTo);
    }

    queryText += ' ORDER BY c.consumption_date DESC';

    const results = await query<StockConsumption>(queryText, params);
    return results;
  } catch (error) {
    log.error('Failed to get consumptions by technician', { error }, 'consumptionService');
    throw error;
  }
}

/**
 * Verify consumption record
 */
export async function verifyConsumption(
  consumptionId: string,
  verifiedBy: string
): Promise<StockConsumption> {
  try {
    const results = await poolSql`
      UPDATE stock_consumptions
      SET
        verified = true,
        verified_by = ${verifiedBy},
        verified_at = NOW()
      WHERE id = ${consumptionId}
      RETURNING
        id,
        drop_number as "dropNumber",
        serial_number as "serialNumber",
        verified,
        verified_by as "verifiedBy",
        verified_at as "verifiedAt"
    `;

    log.info(`Verified consumption: ${consumptionId}`, undefined, 'consumptionService');
    return results[0] as unknown as StockConsumption;
  } catch (error) {
    log.error('Failed to verify consumption', { error }, 'consumptionService');
    throw error;
  }
}

/**
 * Get unverified consumptions count
 */
export async function getUnverifiedCount(): Promise<number> {
  try {
    const results = await poolSql`
      SELECT COUNT(*) as count
      FROM stock_consumptions
      WHERE verified = false
    `;

    return Number(results[0]?.count || 0);
  } catch (error) {
    log.error('Failed to get unverified count', { error }, 'consumptionService');
    throw error;
  }
}

/**
 * Get consumption summary for a technician
 */
export async function getTechnicianConsumptionSummary(
  technicianId: string
): Promise<{
  totalConsumptions: number;
  totalQuantity: number;
  serializedItems: number;
  unverified: number;
}> {
  try {
    const results = await poolSql`
      SELECT
        COUNT(*) as "totalConsumptions",
        SUM(quantity) as "totalQuantity",
        COUNT(serial_id) as "serializedItems",
        SUM(CASE WHEN verified = false THEN 1 ELSE 0 END) as "unverified"
      FROM stock_consumptions
      WHERE consumed_by_id = ${technicianId}
    `;

    const row = results[0] || {};
    return {
      totalConsumptions: Number(row.totalConsumptions || 0),
      totalQuantity:     Number(row.totalQuantity     || 0),
      serializedItems:   Number(row.serializedItems   || 0),
      unverified:        Number(row.unverified        || 0),
    };
  } catch (error) {
    log.error('Failed to get technician consumption summary', { error }, 'consumptionService');
    throw error;
  }
}
