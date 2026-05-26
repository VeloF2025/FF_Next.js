/**
 * Location Service
 * CRUD operations for stock locations
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { query } from './db';
import type {
  StockLocation,
  CreateLocationInput,
  UpdateLocationInput,
  LocationFilters,
  LocationType,
} from '../types';

const sql = neon(process.env.DATABASE_URL!);

export interface LocationDeletionCheck {
  deletable: boolean;
  reason?: string;
}

/**
 * Pure rule: a location may only be soft-deleted when it holds no stock.
 * Defensive: any non-positive-finite on-hand other than exactly 0 is blocked.
 */
export function checkLocationDeletable(stockOnHand: number): LocationDeletionCheck {
  if (!Number.isFinite(stockOnHand) || stockOnHand !== 0) {
    if (stockOnHand > 0) {
      return {
        deletable: false,
        reason: `Cannot delete: ${stockOnHand} unit(s) of stock still held at this location. Move or consume the stock first.`,
      };
    }
    // NaN or negative → unknown state, refuse rather than risk losing a record with stock.
    return {
      deletable: false,
      reason: 'Cannot delete: stock level for this location could not be confirmed.',
    };
  }
  return { deletable: true };
}

/**
 * Get all locations with optional filters
 */
export async function getLocations(
  filters?: LocationFilters
): Promise<StockLocation[]> {
  try {
    let queryText = `
      SELECT
        id,
        parent_id as "parentId",
        code,
        name,
        location_type as "locationType",
        address,
        coordinates,
        assigned_to_id as "assignedToId",
        assigned_to_name as "assignedToName",
        assigned_to_phone as "assignedToPhone",
        project_id as "projectId",
        is_active as "isActive",
        is_virtual as "isVirtual",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy",
        bin_type as "binType"
      FROM stock_locations
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.locationType) {
      queryText += ` AND location_type = $${paramIndex++}`;
      params.push(filters.locationType);
    }

    if (filters?.projectId) {
      queryText += ` AND project_id = $${paramIndex++}`;
      params.push(filters.projectId);
    }

    if (filters?.assignedToId) {
      queryText += ` AND assigned_to_id = $${paramIndex++}`;
      params.push(filters.assignedToId);
    }

    if (filters?.isActive !== undefined) {
      queryText += ` AND is_active = $${paramIndex++}`;
      params.push(filters.isActive);
    }

    if (filters?.parentId) {
      queryText += ` AND parent_id = $${paramIndex++}`;
      params.push(filters.parentId);
    }

    if (filters?.search) {
      queryText += ` AND (name ILIKE $${paramIndex} OR code ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    queryText += ' ORDER BY name ASC';

    const results = await query<StockLocation>(queryText, params);
    return results;
  } catch (error) {
    log.error('Failed to get locations', { error }, 'locationService');
    throw error;
  }
}

/**
 * Get a single location by ID
 */
export async function getLocationById(id: string): Promise<StockLocation | null> {
  try {
    const results = await sql`
      SELECT
        id,
        parent_id as "parentId",
        code,
        name,
        location_type as "locationType",
        address,
        coordinates,
        assigned_to_id as "assignedToId",
        assigned_to_name as "assignedToName",
        assigned_to_phone as "assignedToPhone",
        project_id as "projectId",
        is_active as "isActive",
        is_virtual as "isVirtual",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy"
      FROM stock_locations
      WHERE id = ${id}
    `;

    return (results[0] as StockLocation) || null;
  } catch (error) {
    log.error('Failed to get location by ID', { error }, 'locationService');
    throw error;
  }
}

/**
 * Get a location by code
 */
export async function getLocationByCode(code: string): Promise<StockLocation | null> {
  try {
    const results = await sql`
      SELECT
        id,
        parent_id as "parentId",
        code,
        name,
        location_type as "locationType",
        address,
        coordinates,
        assigned_to_id as "assignedToId",
        assigned_to_name as "assignedToName",
        assigned_to_phone as "assignedToPhone",
        project_id as "projectId",
        is_active as "isActive",
        is_virtual as "isVirtual",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy"
      FROM stock_locations
      WHERE code = ${code}
    `;

    return (results[0] as StockLocation) || null;
  } catch (error) {
    log.error('Failed to get location by code', { error }, 'locationService');
    throw error;
  }
}

/**
 * Create a new location
 */
export async function createLocation(
  input: CreateLocationInput,
  createdBy?: string
): Promise<StockLocation> {
  try {
    const results = await sql`
      INSERT INTO stock_locations (
        parent_id,
        code,
        name,
        location_type,
        address,
        coordinates,
        assigned_to_id,
        assigned_to_name,
        assigned_to_phone,
        project_id,
        is_virtual,
        created_by
      ) VALUES (
        ${input.parentId || null},
        ${input.code},
        ${input.name},
        ${input.locationType},
        ${input.address || null},
        ${input.coordinates ? JSON.stringify(input.coordinates) : null},
        ${input.assignedToId || null},
        ${input.assignedToName || null},
        ${input.assignedToPhone || null},
        ${input.projectId || null},
        ${input.isVirtual || false},
        ${createdBy || null}
      )
      RETURNING
        id,
        parent_id as "parentId",
        code,
        name,
        location_type as "locationType",
        address,
        coordinates,
        assigned_to_id as "assignedToId",
        assigned_to_name as "assignedToName",
        assigned_to_phone as "assignedToPhone",
        project_id as "projectId",
        is_active as "isActive",
        is_virtual as "isVirtual",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy"
    `;

    log.info(`Created location: ${input.code}`, undefined, 'locationService');
    return results[0] as StockLocation;
  } catch (error) {
    log.error('Failed to create location', { error }, 'locationService');
    throw error;
  }
}

/**
 * Update a location
 */
export async function updateLocation(
  id: string,
  input: UpdateLocationInput
): Promise<StockLocation> {
  try {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(input.name);
    }

    if (input.parentId !== undefined) {
      setClauses.push(`parent_id = $${paramIndex++}`);
      params.push(input.parentId || null);
    }

    if (input.address !== undefined) {
      setClauses.push(`address = $${paramIndex++}`);
      params.push(input.address);
    }

    if (input.coordinates !== undefined) {
      setClauses.push(`coordinates = $${paramIndex++}`);
      params.push(JSON.stringify(input.coordinates));
    }

    if (input.assignedToId !== undefined) {
      setClauses.push(`assigned_to_id = $${paramIndex++}`);
      params.push(input.assignedToId);
    }

    if (input.assignedToName !== undefined) {
      setClauses.push(`assigned_to_name = $${paramIndex++}`);
      params.push(input.assignedToName);
    }

    if (input.assignedToPhone !== undefined) {
      setClauses.push(`assigned_to_phone = $${paramIndex++}`);
      params.push(input.assignedToPhone);
    }

    if (input.projectId !== undefined) {
      setClauses.push(`project_id = $${paramIndex++}`);
      params.push(input.projectId);
    }

    if (input.isActive !== undefined) {
      setClauses.push(`is_active = $${paramIndex++}`);
      params.push(input.isActive);
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    const queryText = `
      UPDATE stock_locations
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING
        id,
        parent_id as "parentId",
        code,
        name,
        location_type as "locationType",
        address,
        coordinates,
        assigned_to_id as "assignedToId",
        assigned_to_name as "assignedToName",
        assigned_to_phone as "assignedToPhone",
        project_id as "projectId",
        is_active as "isActive",
        is_virtual as "isVirtual",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy"
    `;

    const results = await query<StockLocation>(queryText, params);
    if (!results[0]) {
      throw new Error(`Location ${id} not found`);
    }
    log.info(`Updated location: ${id}`, undefined, 'locationService');
    return results[0];
  } catch (error) {
    log.error('Failed to update location', { error }, 'locationService');
    throw error;
  }
}

/**
 * Delete a location (soft delete by setting is_active = false)
 * Blocks deletion if the location still holds stock.
 */
export async function deleteLocation(id: string): Promise<void> {
  try {
    // NOTE: on-hand is read from stock_quants, which the GRN flow does not yet
    // populate (Sprint A — ledger consolidation). Until Sprint A lands this guard
    // is effectively permissive for GRN-received stock; the rule is correct, its
    // data source becomes authoritative once GRN writes stock_quants.
    const onHand = await getLocationStockCount(id);
    const check = checkLocationDeletable(onHand);
    if (!check.deletable) {
      const err = new Error(check.reason) as Error & { code?: string };
      err.code = 'LOCATION_NOT_EMPTY';
      throw err;
    }
    await sql`
      UPDATE stock_locations
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;
    log.info(`Deleted location: ${id}`, undefined, 'locationService');
  } catch (error) {
    if ((error as { code?: string }).code === 'LOCATION_NOT_EMPTY') {
      throw error; // expected business-rule rejection — not an error to log
    }
    log.error('Failed to delete location', { error }, 'locationService');
    throw error;
  }
}

/**
 * Get all technician van stock locations
 */
export async function getTechnicianLocations(): Promise<StockLocation[]> {
  try {
    const results = await sql`
      SELECT
        id,
        parent_id as "parentId",
        code,
        name,
        location_type as "locationType",
        address,
        coordinates,
        assigned_to_id as "assignedToId",
        assigned_to_name as "assignedToName",
        assigned_to_phone as "assignedToPhone",
        project_id as "projectId",
        is_active as "isActive",
        is_virtual as "isVirtual",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy"
      FROM stock_locations
      WHERE location_type = 'technician'
        AND is_active = true
      ORDER BY assigned_to_name ASC
    `;

    return results as StockLocation[];
  } catch (error) {
    log.error('Failed to get technician locations', { error }, 'locationService');
    throw error;
  }
}

/**
 * Get location hierarchy (tree structure)
 */
export async function getLocationHierarchy(
  rootType?: LocationType
): Promise<StockLocation[]> {
  try {
    let queryText = `
      SELECT
        id,
        parent_id as "parentId",
        code,
        name,
        location_type as "locationType",
        address,
        coordinates,
        assigned_to_id as "assignedToId",
        assigned_to_name as "assignedToName",
        assigned_to_phone as "assignedToPhone",
        project_id as "projectId",
        is_active as "isActive",
        is_virtual as "isVirtual",
        created_at as "createdAt",
        updated_at as "updatedAt",
        created_by as "createdBy"
      FROM stock_locations
      WHERE is_active = true
    `;

    const params: unknown[] = [];

    if (rootType) {
      queryText += ` AND location_type = $1`;
      params.push(rootType);
    }

    queryText += ' ORDER BY location_type, name';

    const locations = await query<StockLocation>(queryText, params);

    // Build tree structure
    const locationMap = new Map<string, StockLocation>();
    const rootLocations: StockLocation[] = [];

    // First pass: create map
    for (const loc of locations) {
      loc.children = [];
      locationMap.set(loc.id, loc);
    }

    // Second pass: build tree
    for (const loc of locations) {
      if (loc.parentId && locationMap.has(loc.parentId)) {
        const parent = locationMap.get(loc.parentId)!;
        parent.children = parent.children || [];
        parent.children.push(loc);
      } else {
        rootLocations.push(loc);
      }
    }

    return rootLocations;
  } catch (error) {
    log.error('Failed to get location hierarchy', { error }, 'locationService');
    throw error;
  }
}

/**
 * Get stock count for a location
 */
export async function getLocationStockCount(locationId: string): Promise<number> {
  try {
    const results = await sql`
      SELECT COALESCE(SUM(quantity), 0) as count
      FROM stock_quants
      WHERE location_id = ${locationId}
    `;

    return Number(results[0]?.count || 0);
  } catch (error) {
    log.error('Failed to get location stock count', { error }, 'locationService');
    throw error;
  }
}
