/**
 * Staff Create Service
 * Handles POST (create) and DELETE operations for the staff API.
 */

import { getSql } from '@/lib/neon-sql';
import { logCreate, logDelete } from '@/lib/db-logger';
import { createLogger } from '@/lib/logger';

const log = createLogger('StaffCreateService');

/** Raw request body shape accepted by the create endpoint */
export interface StaffCreateInput {
  name?: string;
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  join_date?: string;
  startDate?: string;
  status?: string;
  whatsappId?: string;
  whatsapp_id?: string;
  employee_id?: string;
  employeeId?: string;
  [key: string]: unknown;
}

/** Structured error returned by createStaff when a constraint fires */
export interface StaffCreateError {
  status: number;
  code: string;
  message: string;
}

/** Union result — either the created row or a structured error */
export type StaffCreateResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: StaffCreateError };

/**
 * Auto-generate the next VF employee ID from the existing sequence.
 * Finds the highest VFxxx and increments; falls back to VF001.
 */
async function generateEmployeeId(sql: ReturnType<typeof getSql>): Promise<string> {
  const maxResult = (await sql`
    SELECT employee_id FROM staff
    WHERE employee_id ~ '^VF[0-9]+$'
    ORDER BY CAST(SUBSTRING(employee_id FROM 3) AS INTEGER) DESC
    LIMIT 1
  `) as { employee_id: string }[];

  if (maxResult.length > 0 && maxResult[0]) {
    const currentMax = parseInt(maxResult[0].employee_id.substring(2), 10);
    return `VF${String(currentMax + 1).padStart(3, '0')}`;
  }
  return 'VF001';
}

/**
 * Insert a new staff member into the database.
 * Returns the created record or a structured error for known constraint violations.
 */
export async function createStaff(input: StaffCreateInput): Promise<StaffCreateResult> {
  const sql = getSql();

  const name = input.name ?? '';
  const firstName = input.first_name ?? input.firstName ?? name.split(' ')[0] ?? '';
  const lastName = input.last_name ?? input.lastName ?? name.split(' ').slice(1).join(' ') ?? '';

  let employeeId = input.employee_id ?? input.employeeId;
  if (!employeeId) {
    employeeId = await generateEmployeeId(sql);
  }

  try {
    const rows = (await sql`
      INSERT INTO staff (
        employee_id, first_name, last_name, email, phone,
        department, position, join_date, status, whatsapp_id
      )
      VALUES (
        ${employeeId},
        ${firstName},
        ${lastName},
        ${input.email ?? null},
        ${input.phone ?? null},
        ${input.department ?? 'General'},
        ${input.position ?? null},
        ${input.join_date ?? input.startDate ?? new Date().toISOString()},
        ${input.status ?? 'ACTIVE'},
        ${input.whatsappId ?? input.whatsapp_id ?? null}
      )
      RETURNING *,
        CONCAT(first_name, ' ', last_name) as name,
        CONCAT(first_name, ' ', last_name) as full_name,
        sa_id_number as "saIdNumber",
        passport_number as "passportNumber",
        passport_country as "passportCountry",
        passport_expiry as "passportExpiry",
        whatsapp_id as "whatsappId"
    `) as Record<string, unknown>[];

    const created = rows[0];
    if (created) {
      logCreate('staff', created.id as string, {
        employee_id: created.employee_id,
        name: created.full_name,
        email: created.email,
        department: created.department,
      });
    }

    if (!created) {
      throw new Error('Insert returned no rows');
    }
    return { ok: true, data: created };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('createStaff db error', { error: message });

    if (message.includes('staff_email_unique')) {
      return {
        ok: false,
        error: {
          status: 409,
          code: 'DUPLICATE_EMAIL',
          message: `A staff member with email "${input.email}" already exists. Please use a different email address.`,
        },
      };
    }
    if (message.includes('staff_employee_id_unique')) {
      return {
        ok: false,
        error: {
          status: 409,
          code: 'DUPLICATE_EMPLOYEE_ID',
          message: `Employee ID "${employeeId}" is already in use. Please use a different employee ID.`,
        },
      };
    }
    if (message.includes('duplicate key value')) {
      return {
        ok: false,
        error: {
          status: 409,
          code: 'DUPLICATE_ENTRY',
          message: 'This staff member already exists. Please check the email and employee ID.',
        },
      };
    }

    // Unknown error — re-throw for the outer error handler
    throw error;
  }
}

/**
 * Delete a staff member and all their associated records.
 * Clears foreign-key references before removing to avoid constraint violations.
 */
export async function deleteStaffMember(staffId: string): Promise<void> {
  const sql = getSql();

  // Clear FK references in parent tables (soft cascade)
  await sql`UPDATE projects SET project_manager = NULL WHERE project_manager = ${staffId}`;
  await sql`UPDATE projects SET team_lead = NULL WHERE team_lead = ${staffId}`;
  await sql`UPDATE staff SET reports_to = NULL WHERE reports_to = ${staffId}`;
  await sql`UPDATE staff SET exit_processed_by = NULL WHERE exit_processed_by = ${staffId}`;
  await sql`UPDATE staff SET bank_verified_by = NULL WHERE bank_verified_by = ${staffId}`;
  await sql`UPDATE maintenance_tickets SET assigned_to = NULL WHERE assigned_to = ${staffId}`;
  await sql`UPDATE action_items SET assigned_to = NULL WHERE assigned_to = ${staffId}`;
  await sql`UPDATE fleet_vehicles SET assigned_driver_id = NULL WHERE assigned_driver_id = ${staffId}`;

  // Delete child records
  await sql`DELETE FROM staff_documents WHERE staff_id = ${staffId}`;
  await sql`DELETE FROM staff_notes WHERE staff_id = ${staffId}`;
  await sql`DELETE FROM staff_projects WHERE staff_id = ${staffId}`;
  await sql`DELETE FROM staff_compliance_status WHERE staff_id = ${staffId}`;
  await sql`DELETE FROM staff_audit_log WHERE staff_id = ${staffId}`;
  await sql`DELETE FROM disciplinary_incidents WHERE staff_id = ${staffId}`;
  await sql`DELETE FROM vehicle_assignments WHERE staff_id = ${staffId}`;
  await sql`DELETE FROM fleet_driver_scores WHERE staff_id = ${staffId}`;
  await sql`DELETE FROM fleet_check_reminders WHERE driver_id = ${staffId}`;
  await sql`DELETE FROM fleet_portal_sessions WHERE driver_id = ${staffId}`;

  await sql`DELETE FROM staff WHERE id = ${staffId}`;

  logDelete('staff', staffId);
}
