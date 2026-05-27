/**
 * Inline casual-staff creation for the combined-PDF importer.
 *
 * The HR preview lets the user resolve an unmatched payslip page by creating
 * a fresh staff record on the fly. This service handles the INSERT + maps
 * common Postgres unique-violations to friendly errors, so the API route
 * can surface a useful message in the preview UI.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';

import { normaliseSaPhone } from '../casualInput';
import type { CasualCreate } from '../types';

export type CreateCasualResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createCasualStaff(
  create: CasualCreate,
  empCode: string | null
): Promise<CreateCasualResult> {
  const employmentType = create.employmentType ?? 'casual';
  const employeeId = empCode;
  const phoneNormalised = normaliseSaPhone(create.phone) ?? create.phone.trim();

  try {
    const rows = await sql<{ id: string }>`
      INSERT INTO staff (
        employee_id,
        first_name,
        last_name,
        email,
        phone,
        department,
        status,
        join_date,
        employment_type,
        payroll_code
      )
      VALUES (
        ${employeeId},
        ${create.firstName.trim()},
        ${create.lastName.trim()},
        ${create.email.toLowerCase().trim()},
        ${phoneNormalised},
        'General',
        'ACTIVE',
        NOW(),
        ${employmentType},
        ${empCode}
      )
      RETURNING id
    `;
    const inserted = rows[0];
    if (!inserted) return { ok: false, error: 'insert returned no row' };
    return { ok: true, id: inserted.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('staff_email_unique')) {
      return {
        ok: false,
        error: `email "${create.email}" is already used by another staff member`,
      };
    }
    if (msg.includes('staff_employee_id_unique')) {
      return {
        ok: false,
        error: `employee_id "${employeeId}" is already used by another staff member`,
      };
    }
    if (msg.includes('staff_payroll_code_unique')) {
      return {
        ok: false,
        error: `payroll_code "${empCode}" is already mapped to another staff member`,
      };
    }
    log.error('[payslips/createCasualStaff] insert failed', {
      err: msg,
      empCode,
      email: create.email,
    });
    return { ok: false, error: msg };
  }
}
