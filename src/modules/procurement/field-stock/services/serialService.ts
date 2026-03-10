/**
 * Serial Service
 * Operations for serial number tracking (ONTs, Routers, Mini-UPS)
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { query } from './db';
import type {
  StockSerial,
  RegisterSerialInput,
  SerialFilters,
  SerialStatus,
} from '../types';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Get serials with filters
 */
export async function getSerials(filters?: SerialFilters): Promise<StockSerial[]> {
  try {
    let queryText = `
      SELECT
        s.id,
        s.stock_item_id as "stockItemId",
        s.serial_number as "serialNumber",
        s.mac_address as "macAddress",
        s.imei,
        s.current_location_id as "currentLocationId",
        s.status,
        s.installed_at_drop_id as "installedAtDropId",
        s.installed_at_drop_number as "installedAtDropNumber",
        s.installed_at_home_install_id as "installedAtHomeInstallId",
        s.installed_date as "installedDate",
        s.installed_by as "installedBy",
        s.received_date as "receivedDate",
        s.received_reference as "receivedReference",
        s.warranty_end_date as "warrantyEndDate",
        s.condition,
        s.created_at as "createdAt",
        s.updated_at as "updatedAt",
        i.item_code as "itemCode",
        i.name as "itemName",
        i.category as "itemCategory",
        l.code as "locationCode",
        l.name as "locationName"
      FROM stock_serials s
      LEFT JOIN stock_items i ON i.id = s.stock_item_id
      LEFT JOIN stock_locations l ON l.id = s.current_location_id
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.stockItemId) {
      queryText += ` AND s.stock_item_id = $${paramIndex++}`;
      params.push(filters.stockItemId);
    }

    if (filters?.status) {
      queryText += ` AND s.status = $${paramIndex++}`;
      params.push(filters.status);
    }

    if (filters?.locationId) {
      queryText += ` AND s.current_location_id = $${paramIndex++}`;
      params.push(filters.locationId);
    }

    if (filters?.installedAtDropNumber) {
      queryText += ` AND s.installed_at_drop_number = $${paramIndex++}`;
      params.push(filters.installedAtDropNumber);
    }

    if (filters?.search) {
      queryText += ` AND (s.serial_number ILIKE $${paramIndex} OR s.mac_address ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    queryText += ' ORDER BY s.created_at DESC';

    const results = await query<StockSerial>(queryText, params);
    return results;
  } catch (error) {
    log.error('Failed to get serials', error, 'serialService');
    throw error;
  }
}

/**
 * Get a serial by its number
 */
export async function getSerialByNumber(serialNumber: string): Promise<StockSerial | null> {
  try {
    const results = await sql`
      SELECT
        s.id,
        s.stock_item_id as "stockItemId",
        s.serial_number as "serialNumber",
        s.mac_address as "macAddress",
        s.imei,
        s.current_location_id as "currentLocationId",
        s.status,
        s.installed_at_drop_id as "installedAtDropId",
        s.installed_at_drop_number as "installedAtDropNumber",
        s.installed_at_home_install_id as "installedAtHomeInstallId",
        s.installed_date as "installedDate",
        s.installed_by as "installedBy",
        s.received_date as "receivedDate",
        s.received_reference as "receivedReference",
        s.warranty_end_date as "warrantyEndDate",
        s.condition,
        s.created_at as "createdAt",
        s.updated_at as "updatedAt"
      FROM stock_serials s
      WHERE s.serial_number = ${serialNumber}
    `;

    return (results[0] as StockSerial) || null;
  } catch (error) {
    log.error('Failed to get serial by number', error, 'serialService');
    throw error;
  }
}

/**
 * Get a serial by ID
 */
export async function getSerialById(id: string): Promise<StockSerial | null> {
  try {
    const results = await sql`
      SELECT
        s.id,
        s.stock_item_id as "stockItemId",
        s.serial_number as "serialNumber",
        s.mac_address as "macAddress",
        s.imei,
        s.current_location_id as "currentLocationId",
        s.status,
        s.installed_at_drop_id as "installedAtDropId",
        s.installed_at_drop_number as "installedAtDropNumber",
        s.installed_at_home_install_id as "installedAtHomeInstallId",
        s.installed_date as "installedDate",
        s.installed_by as "installedBy",
        s.received_date as "receivedDate",
        s.received_reference as "receivedReference",
        s.warranty_end_date as "warrantyEndDate",
        s.condition,
        s.created_at as "createdAt",
        s.updated_at as "updatedAt"
      FROM stock_serials s
      WHERE s.id = ${id}
    `;

    return (results[0] as StockSerial) || null;
  } catch (error) {
    log.error('Failed to get serial by ID', error, 'serialService');
    throw error;
  }
}

/**
 * Register a new serial number
 */
export async function registerSerial(input: RegisterSerialInput): Promise<StockSerial> {
  try {
    const results = await sql`
      INSERT INTO stock_serials (
        stock_item_id,
        serial_number,
        mac_address,
        imei,
        current_location_id,
        status,
        received_date,
        received_reference,
        warranty_end_date
      ) VALUES (
        ${input.stockItemId},
        ${input.serialNumber},
        ${input.macAddress || null},
        ${input.imei || null},
        ${input.locationId},
        'available',
        ${input.receivedDate || null},
        ${input.receivedReference || null},
        ${input.warrantyEndDate || null}
      )
      RETURNING
        id,
        stock_item_id as "stockItemId",
        serial_number as "serialNumber",
        mac_address as "macAddress",
        imei,
        current_location_id as "currentLocationId",
        status,
        condition,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    log.info(`Registered serial: ${input.serialNumber}`, undefined, 'serialService');
    return results[0] as StockSerial;
  } catch (error) {
    log.error('Failed to register serial', error, 'serialService');
    throw error;
  }
}

/**
 * Update serial status
 */
export async function updateSerialStatus(
  id: string,
  status: SerialStatus,
  locationId?: string
): Promise<StockSerial> {
  try {
    const results = await sql`
      UPDATE stock_serials
      SET
        status = ${status},
        current_location_id = COALESCE(${locationId || null}, current_location_id),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING
        id,
        stock_item_id as "stockItemId",
        serial_number as "serialNumber",
        status,
        current_location_id as "currentLocationId",
        updated_at as "updatedAt"
    `;

    log.info(`Updated serial status: ${id} -> ${status}`, undefined, 'serialService');
    return results[0] as StockSerial;
  } catch (error) {
    log.error('Failed to update serial status', error, 'serialService');
    throw error;
  }
}

/**
 * Mark serial as installed at a drop
 */
export async function markSerialInstalled(
  serialId: string,
  dropId: string,
  dropNumber: string,
  installedBy: string
): Promise<StockSerial> {
  try {
    const results = await sql`
      UPDATE stock_serials
      SET
        status = 'installed',
        installed_at_drop_id = ${dropId},
        installed_at_drop_number = ${dropNumber},
        installed_date = NOW(),
        installed_by = ${installedBy},
        updated_at = NOW()
      WHERE id = ${serialId}
      RETURNING
        id,
        stock_item_id as "stockItemId",
        serial_number as "serialNumber",
        status,
        installed_at_drop_id as "installedAtDropId",
        installed_at_drop_number as "installedAtDropNumber",
        installed_date as "installedDate",
        installed_by as "installedBy"
    `;

    log.info(`Serial ${serialId} installed at drop ${dropNumber}`, undefined, 'serialService');
    return results[0] as StockSerial;
  } catch (error) {
    log.error('Failed to mark serial installed', error, 'serialService');
    throw error;
  }
}

/**
 * Get available serials for a specific item
 */
export async function getAvailableSerials(stockItemId: string): Promise<StockSerial[]> {
  try {
    const results = await sql`
      SELECT
        s.id,
        s.stock_item_id as "stockItemId",
        s.serial_number as "serialNumber",
        s.mac_address as "macAddress",
        s.imei,
        s.current_location_id as "currentLocationId",
        s.status,
        s.condition,
        l.code as "locationCode",
        l.name as "locationName"
      FROM stock_serials s
      LEFT JOIN stock_locations l ON l.id = s.current_location_id
      WHERE s.stock_item_id = ${stockItemId}
        AND s.status = 'available'
      ORDER BY s.serial_number
    `;

    return results as StockSerial[];
  } catch (error) {
    log.error('Failed to get available serials', error, 'serialService');
    throw error;
  }
}

/**
 * Get serials held by a technician
 */
export async function getSerialsByTechnician(technicianLocationId: string): Promise<StockSerial[]> {
  try {
    const results = await sql`
      SELECT
        s.id,
        s.stock_item_id as "stockItemId",
        s.serial_number as "serialNumber",
        s.mac_address as "macAddress",
        s.status,
        s.condition,
        i.item_code as "itemCode",
        i.name as "itemName",
        i.category as "itemCategory"
      FROM stock_serials s
      LEFT JOIN stock_items i ON i.id = s.stock_item_id
      WHERE s.current_location_id = ${technicianLocationId}
        AND s.status = 'issued'
      ORDER BY i.category, s.serial_number
    `;

    return results as StockSerial[];
  } catch (error) {
    log.error('Failed to get technician serials', error, 'serialService');
    throw error;
  }
}

/**
 * Validate serial for consumption
 * Checks that serial exists, is issued, and is at the right location
 */
export async function validateSerialForConsumption(
  serialNumber: string,
  technicianLocationId: string
): Promise<{ valid: boolean; serial?: StockSerial; error?: string }> {
  try {
    const serial = await getSerialByNumber(serialNumber);

    if (!serial) {
      return { valid: false, error: `Serial ${serialNumber} not found in system` };
    }

    if (serial.status !== 'issued') {
      return {
        valid: false,
        serial,
        error: `Serial ${serialNumber} is not in 'issued' status (current: ${serial.status})`,
      };
    }

    if (serial.currentLocationId !== technicianLocationId) {
      return {
        valid: false,
        serial,
        error: `Serial ${serialNumber} is not assigned to this technician`,
      };
    }

    return { valid: true, serial };
  } catch (error) {
    log.error('Failed to validate serial for consumption', error, 'serialService');
    throw error;
  }
}

/**
 * Get serial audit trail
 */
export async function getSerialHistory(serialId: string): Promise<unknown[]> {
  try {
    const results = await sql`
      SELECT
        m.id,
        m.movement_type as "movementType",
        m.from_location_id as "fromLocationId",
        m.to_location_id as "toLocationId",
        m.reference,
        m.notes,
        m.performed_by as "performedBy",
        m.performed_at as "performedAt",
        fl.name as "fromLocationName",
        tl.name as "toLocationName"
      FROM field_stock_movements m
      LEFT JOIN stock_locations fl ON fl.id = m.from_location_id
      LEFT JOIN stock_locations tl ON tl.id = m.to_location_id
      WHERE m.serial_id = ${serialId}
      ORDER BY m.performed_at DESC
    `;

    return results;
  } catch (error) {
    log.error('Failed to get serial history', error, 'serialService');
    throw error;
  }
}
