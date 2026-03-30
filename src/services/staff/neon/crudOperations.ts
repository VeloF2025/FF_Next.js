/**
 * Staff CRUD Operations
 * Core CRUD operations for staff management
 */

import { getSql } from '@/lib/neon-sql';
import { StaffMember, StaffFormData } from '@/types/staff.types';
import { validateStaffData, processReportsToField, logDebugInfo, logError } from './validators';
import { log } from '@/lib/logger';

/**
 * Create new staff member
 */
export async function createStaff(data: Partial<StaffMember>): Promise<StaffMember> {
  try {
    const formData = data as unknown as StaffFormData;
    logDebugInfo('CREATE', formData, formData.reportsTo);

    // Validate required fields
    validateStaffData(formData);

    // Process reportsTo field
    const processedReportsTo = processReportsToField(formData.reportsTo);

    const result = await getSql()`
      INSERT INTO staff (
        employee_id, name, email, phone, department, position,
        status, join_date, reports_to, created_at, updated_at
      ) VALUES (
        ${(formData.employeeId || '').trim()}, ${(formData.name || '').trim()}, ${(formData.email || '').trim()}, ${(formData.phone || '').trim()},
        ${formData.department}, ${formData.position}, ${formData.status || 'ACTIVE'},
        ${formData.startDate || new Date()}, ${processedReportsTo},
        NOW(), NOW()
      ) RETURNING *
    `;

    const rows = result as any[];
    return rows[0] as StaffMember;
  } catch (error) {
    logError('CREATE', error, data);
    throw error;
  }
}

/**
 * Create or update staff member by employee ID (upsert operation)
 */
export async function createOrUpdateStaff(data: Partial<StaffMember>): Promise<StaffMember> {
  try {
    const formData = data as unknown as StaffFormData;
    logDebugInfo('CREATE_OR_UPDATE', formData, formData.reportsTo);

    // Validate required fields
    validateStaffData(formData);

    // Process reportsTo field
    const processedReportsTo = processReportsToField(formData.reportsTo);

    // Check if staff member exists by employee_id
    const existing = await getSql()`
      SELECT id FROM staff WHERE employee_id = ${formData.employeeId}
    `;

    const existingRows = existing as any[];
    if (existingRows.length > 0) {
      // Update existing staff member
      const result = await getSql()`
        UPDATE staff SET
          name = ${formData.name},
          email = ${formData.email},
          phone = ${formData.phone},
          department = ${formData.department},
          position = ${formData.position},
          status = ${formData.status || 'ACTIVE'},
          reports_to = ${processedReportsTo},
          updated_at = NOW()
        WHERE employee_id = ${formData.employeeId}
        RETURNING *
      `;

      const rows = result as any[];
      return rows[0] as StaffMember;
    } else {
      // Create new staff member
      const result = await getSql()`
        INSERT INTO staff (
          employee_id, name, email, phone, department, position,
          status, join_date, reports_to, created_at, updated_at
        ) VALUES (
          ${formData.employeeId}, ${formData.name}, ${formData.email}, ${formData.phone},
          ${formData.department}, ${formData.position}, ${formData.status || 'ACTIVE'},
          ${formData.startDate || new Date()}, ${processedReportsTo},
          NOW(), NOW()
        ) RETURNING *
      `;

      const rows = result as any[];
      return rows[0] as StaffMember;
    }
  } catch (error) {
    logError('CREATE_OR_UPDATE', error, data);
    throw error;
  }
}

/**
 * Update staff member
 */
export async function updateStaff(id: string, data: Partial<StaffMember>): Promise<StaffMember> {
  try {
    // Handle empty string for UUID fields - convert to null
    const reportsTo = data.reportsTo && data.reportsTo.trim() !== '' ? data.reportsTo : null;

    const result = await getSql()`
      UPDATE staff SET
        name = ${data.name},
        email = ${data.email},
        phone = ${data.phone},
        department = ${data.department},
        position = ${data.position},
        status = ${data.status},
        reports_to = ${reportsTo},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    const rows = result as any[];
    return rows[0] as StaffMember;
  } catch (error) {
    log.error('Error updating staff member:', { data: error }, 'crudOperations');
    throw error;
  }
}

/**
 * Delete staff member
 */
export async function deleteStaff(id: string): Promise<void> {
  try {
    await getSql()`DELETE FROM staff WHERE id = ${id}`;
  } catch (error) {
    log.error('Error deleting staff member:', { data: error }, 'crudOperations');
    throw error;
  }
}