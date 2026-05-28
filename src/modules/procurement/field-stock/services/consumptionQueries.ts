/**
 * Consumption Queries — read path
 * Query functions for stock_consumptions: list, filter, verify, summarise.
 *
 * Write path (recordConsumption) lives in consumptionService.ts.
 */

import { sql as poolSql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { query } from './db';
import type {
  StockConsumption,
  ConsumptionFilters,
} from '../types';

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
    log.error('Failed to get consumptions', { error }, 'consumptionQueries');
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
    log.error('Failed to get consumptions by drop', { error }, 'consumptionQueries');
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
    log.error('Failed to get consumptions by technician', { error }, 'consumptionQueries');
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

    log.info(`Verified consumption: ${consumptionId}`, undefined, 'consumptionQueries');
    return results[0] as unknown as StockConsumption;
  } catch (error) {
    log.error('Failed to verify consumption', { error }, 'consumptionQueries');
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
    log.error('Failed to get unverified count', { error }, 'consumptionQueries');
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
    log.error('Failed to get technician consumption summary', { error }, 'consumptionQueries');
    throw error;
  }
}
