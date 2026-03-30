/**
 * Staff Neon Service Module
 * Central exports for staff service using Neon PostgreSQL
 */

import {
  StaffMember,
  StaffFilter,
  StaffDropdownOption
} from '@/types/staff.types';
import { queryStaffWithFilters, queryStaffById, queryActiveStaff, queryProjectManagers } from './queryBuilders';
import { mapToStaffMember, mapToStaffMembers, mapToDropdownOption } from './dataMappers';
import { createStaff, createOrUpdateStaff, updateStaff, deleteStaff } from './crudOperations';
import { getStaffSummary as getStaffSummaryStats } from './statistics';
import { log } from '@/lib/logger';

/**
 * Helper to safely cast Neon query results to array
 */
function asArray<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return [];
}

/**
 * Staff service using Neon PostgreSQL database
 */
export const staffNeonService = {
  /**
   * Get all staff with optional filtering
   */
  async getAll(filter?: StaffFilter): Promise<StaffMember[]> {
    try {
      const result = await queryStaffWithFilters(filter);
      return mapToStaffMembers(asArray(result));
    } catch (error) {
      log.error('Error fetching staff:', { data: error }, 'index');
      throw error;
    }
  },

  /**
   * Get staff member by ID
   */
  async getById(id: string): Promise<StaffMember | null> {
    try {
      const result = await queryStaffById(id);
      const rows = asArray(result);

      if (rows.length === 0) return null;

      return mapToStaffMember(rows[0]);
    } catch (error) {
      log.error('Error fetching staff member:', { data: error }, 'index');
      throw error;
    }
  },

  /**
   * Create new staff member
   */
  create: createStaff,

  /**
   * Create or update staff member by employee ID (upsert operation)
   */
  createOrUpdate: createOrUpdateStaff,

  /**
   * Update staff member
   */
  update: updateStaff,

  /**
   * Delete staff member
   */
  delete: deleteStaff,

  /**
   * Get active staff for dropdowns
   */
  async getActiveStaff(): Promise<StaffDropdownOption[]> {
    try {
      const result = await queryActiveStaff();
      return asArray(result).map((staff: any) => mapToDropdownOption(staff));
    } catch (error) {
      log.error('Error fetching active staff:', { data: error }, 'index');
      throw error;
    }
  },

  /**
   * Get project managers for dropdowns
   */
  async getProjectManagers(): Promise<StaffDropdownOption[]> {
    try {
      const result = await queryProjectManagers();
      return asArray(result).map((staff: any) => mapToDropdownOption(staff, true));
    } catch (error) {
      log.error('Error fetching project managers:', { data: error }, 'index');
      throw error;
    }
  },

  /**
   * Get staff summary statistics
   */
  getStaffSummary: getStaffSummaryStats
};

// Export all sub-modules for direct access if needed
export * from './queryBuilders';
export * from './dataMappers';
export * from './validators';
export * from './crudOperations';
export * from './statistics';