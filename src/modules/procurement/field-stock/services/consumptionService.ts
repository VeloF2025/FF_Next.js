/**
 * Consumption Service — write path
 * Records material consumption on jobs (drops/installs).
 * THE KEY SERVICE FOR TRACEABILITY
 *
 * Read-path queries (getConsumptions, getConsumptionsByDrop, etc.) live in
 * consumptionQueries.ts to keep this file under the 300-line hard limit.
 */

import { sql as poolSql, transaction } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { postConsumeFromHolderWith } from './custodyService';
import type {
  StockConsumption,
  RecordConsumptionInput,
} from '../types';
import { validateSerialForConsumption } from './serialService';
import { promoteSerial } from './serialLifecycle';

/**
 * Metadata-only update for a serial install — does NOT touch status or holder_id.
 * Status and holder_id are written exclusively via promoteSerial (Sprint E Track 1).
 * Separated from promoteSerial so the validate trigger fires first, then this
 * update sets the install-location columns atomically in the same transaction.
 */
const SQL_INSTALL_SERIAL_METADATA =
  `UPDATE stock_serials SET ` +
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

      // 3. Mark serial installed + clear holder via promoteSerial (Sprint E Track 1).
      //    promoteSerial fires the mig 387 validate + emit triggers in the same txn.
      //    SQL_INSTALL_SERIAL_METADATA follows immediately to record install location
      //    columns; it does not touch status or holder_id.
      //    Note: txn.client is the raw PoolClient; promoteSerial discriminates
      //    Pool vs PoolClient via the presence of `release` on the object.
      if (input.serialId && input.dropId && input.dropNumber) {
        await promoteSerial(txn.client, {
          serialId:     input.serialId,
          toStatus:     'installed',
          toHolderId:   null,
          sourceTable:  'stock_consumptions',
          sourceId:     record.id,
          actorStaffId: input.consumedById ?? null,
          payload: { drop_number: input.dropNumber, drop_id: input.dropId },
        });
        await txn.query(SQL_INSTALL_SERIAL_METADATA, [
          input.serialId,
          input.dropId,
          input.dropNumber,
          input.consumedByName ?? 'Unknown',
        ]);
        log.info(
          `Serial ${input.serialId} installed at drop ${input.dropNumber} via promoteSerial (holder cleared)`,
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
