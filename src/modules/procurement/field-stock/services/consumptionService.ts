/**
 * Consumption Service
 * Records material consumption on jobs (drops/installs)
 * THE KEY SERVICE FOR TRACEABILITY
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { query } from './db';
import type {
  StockConsumption,
  RecordConsumptionInput,
  ConsumptionFilters,
} from '../types';
import { markSerialInstalled, validateSerialForConsumption } from './serialService';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Record material consumption on a job
 * This is the core function that links equipment to drops
 */
export async function recordConsumption(
  input: RecordConsumptionInput
): Promise<StockConsumption> {
  try {
    // Get item details
    const itemResult = await sql`
      SELECT item_code, name, uom FROM stock_items WHERE id = ${input.stockItemId}
    `;

    if (itemResult.length === 0 || !itemResult[0]) {
      throw new Error(`Stock item ${input.stockItemId} not found`);
    }

    const item = itemResult[0];
    const itemCode = item.item_code as string;
    const itemName = item.name as string;
    const itemUom = item.uom as string;

    // If serial tracked, validate and mark as installed
    if (input.serialId && input.serialNumber) {
      const validation = await validateSerialForConsumption(
        input.serialNumber,
        input.consumedFromLocationId
      );

      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Mark serial as installed
      if (input.dropId && input.dropNumber) {
        await markSerialInstalled(
          input.serialId,
          input.dropId,
          input.dropNumber,
          input.consumedByName || 'Unknown'
        );
      }
    }

    // Create consumption record
    const results = await sql`
      INSERT INTO stock_consumptions (
        job_type,
        drop_id,
        drop_number,
        home_install_id,
        stock_item_id,
        item_code,
        item_name,
        quantity,
        uom,
        serial_id,
        serial_number,
        consumed_by_id,
        consumed_by_name,
        consumed_from_location_id,
        gps_lat,
        gps_lng,
        notes
      ) VALUES (
        ${input.jobType},
        ${input.dropId || null},
        ${input.dropNumber || null},
        ${input.homeInstallId || null},
        ${input.stockItemId},
        ${itemCode},
        ${itemName},
        ${input.quantity},
        ${itemUom},
        ${input.serialId || null},
        ${input.serialNumber || null},
        ${input.consumedById || null},
        ${input.consumedByName || null},
        ${input.consumedFromLocationId},
        ${input.gpsLat || null},
        ${input.gpsLng || null},
        ${input.notes || null}
      )
      RETURNING
        id,
        job_type as "jobType",
        drop_id as "dropId",
        drop_number as "dropNumber",
        home_install_id as "homeInstallId",
        stock_item_id as "stockItemId",
        item_code as "itemCode",
        item_name as "itemName",
        quantity,
        uom,
        serial_id as "serialId",
        serial_number as "serialNumber",
        consumed_by_id as "consumedById",
        consumed_by_name as "consumedByName",
        consumed_from_location_id as "consumedFromLocationId",
        consumption_date as "consumptionDate",
        gps_lat as "gpsLat",
        gps_lng as "gpsLng",
        verified,
        notes,
        created_at as "createdAt"
    `;

    const consumption = results[0] as StockConsumption;

    // Update drops table with serial info
    if (input.dropNumber && input.serialNumber) {
      await updateDropWithSerial(input.dropNumber, input.serialNumber, itemCode);
    }

    // Create stock movement record in field_stock_movements table
    await sql`
      INSERT INTO field_stock_movements (
        consumption_id,
        stock_item_id,
        serial_id,
        movement_type,
        from_location_id,
        quantity,
        serial_number,
        reference,
        performed_by,
        performed_at
      ) VALUES (
        ${consumption.id},
        ${input.stockItemId},
        ${input.serialId || null},
        'consumption',
        ${input.consumedFromLocationId},
        ${input.quantity},
        ${input.serialNumber || null},
        ${input.dropNumber || input.homeInstallId || 'N/A'},
        ${input.consumedByName || null},
        NOW()
      )
    `;

    // Update stock quants (decrease technician stock)
    await sql`
      UPDATE stock_quants
      SET
        quantity = quantity - ${input.quantity},
        last_movement_date = NOW(),
        updated_at = NOW()
      WHERE stock_item_id = ${input.stockItemId}
        AND location_id = ${input.consumedFromLocationId}
    `;

    log.info(
      `Recorded consumption: ${input.serialNumber || input.quantity + ' x ' + itemCode} for ${input.dropNumber}`,
      undefined,
      'consumptionService'
    );

    return consumption;
  } catch (error) {
    log.error('Failed to record consumption', error, 'consumptionService');
    throw error;
  }
}

/**
 * Update drops table with serial information
 */
async function updateDropWithSerial(
  dropNumber: string,
  serialNumber: string,
  itemCode: string
): Promise<void> {
  try {
    // Determine which column to update based on item code
    const isOnt = itemCode.toLowerCase().includes('ont');
    const isMiniUps = itemCode.toLowerCase().includes('ups') || itemCode.toLowerCase().includes('gizzu');
    const isRouter = itemCode.toLowerCase().includes('router');

    if (isOnt) {
      await sql`
        UPDATE drops
        SET ont_serial = ${serialNumber}, materials_issued = true, updated_at = NOW()
        WHERE dr_number = ${dropNumber}
      `;
    } else if (isMiniUps) {
      await sql`
        UPDATE drops
        SET mini_ups_serial = ${serialNumber}, materials_issued = true, updated_at = NOW()
        WHERE dr_number = ${dropNumber}
      `;
    } else if (isRouter) {
      await sql`
        UPDATE drops
        SET router_serial = ${serialNumber}, materials_issued = true, updated_at = NOW()
        WHERE dr_number = ${dropNumber}
      `;
    }
  } catch (error) {
    log.error('Failed to update drop with serial', error, 'consumptionService');
    // Don't throw - consumption was recorded, just update failed
  }
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
    log.error('Failed to get consumptions', error, 'consumptionService');
    throw error;
  }
}

/**
 * Get all consumptions for a specific drop
 */
export async function getConsumptionsByDrop(dropNumber: string): Promise<StockConsumption[]> {
  try {
    const results = await sql`
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

    return results as StockConsumption[];
  } catch (error) {
    log.error('Failed to get consumptions by drop', error, 'consumptionService');
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
    log.error('Failed to get consumptions by technician', error, 'consumptionService');
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
    const results = await sql`
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
    return results[0] as StockConsumption;
  } catch (error) {
    log.error('Failed to verify consumption', error, 'consumptionService');
    throw error;
  }
}

/**
 * Get unverified consumptions count
 */
export async function getUnverifiedCount(): Promise<number> {
  try {
    const results = await sql`
      SELECT COUNT(*) as count
      FROM stock_consumptions
      WHERE verified = false
    `;

    return Number(results[0]?.count || 0);
  } catch (error) {
    log.error('Failed to get unverified count', error, 'consumptionService');
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
    const results = await sql`
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
      totalQuantity: Number(row.totalQuantity || 0),
      serializedItems: Number(row.serializedItems || 0),
      unverified: Number(row.unverified || 0),
    };
  } catch (error) {
    log.error('Failed to get technician consumption summary', error, 'consumptionService');
    throw error;
  }
}
