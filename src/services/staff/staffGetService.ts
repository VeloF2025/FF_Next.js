/**
 * Staff Get Service
 * Handles all SELECT queries for staff — single record and filtered list.
 * Each filter combination uses an explicit separate query to comply with the
 * Neon tagged-template restriction (no conditional SQL fragments).
 */

import { getSql } from '@/lib/neon-sql';
import { createLogger } from '@/lib/logger';
import { checkStaffAccess, filterStaffFields, filterStaffList } from './staffAccessService';

const log = createLogger('StaffGetService');

type SqlClient = ReturnType<typeof getSql>;
type StaffRow = Record<string, unknown>;

/** Accepted filter parameters for list queries */
export interface StaffListFilters {
  search?: string | string[];
  department?: string | string[];
  status?: string | string[];
  position?: string | string[];
}

/**
 * Fetch a single staff member by ID with field-level access filtering.
 * Returns null when the record does not exist.
 */
export async function getStaffById(staffId: string, requestingUserId: string): Promise<StaffRow | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      s.*,
      CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.sa_id_number as "saIdNumber", s.id_number as "idNumber",
      s.passport_number as "passportNumber", s.passport_country as "passportCountry",
      s.passport_expiry as "passportExpiry", s.work_permit_number as "workPermitNumber",
      s.work_permit_expiry as "workPermitExpiry", s.id_photo_url as "idPhotoUrl",
      s.profile_photo_url as "profilePhotoUrl", s.photo_match_score as "photoMatchScore",
      s.photo_verified_at as "photoVerifiedAt", s.bank_name as "bankName",
      s.bank_account_number as "bankAccountNumber", s.bank_branch_code as "bankBranchCode",
      s.bank_account_type as "bankAccountType", s.bank_account_holder as "bankAccountHolder",
      s.bank_details_verified_at as "bankDetailsVerifiedAt", s.whatsapp_id as "whatsappId",
      s.alternate_phone as "alternativePhone",
      s.emergency_contact->>'name' as "emergencyContactName",
      s.emergency_contact->>'phone' as "emergencyContactPhone",
      s.emergency_contact_relationship as "emergencyContactRelationship",
      s.next_of_kin_name as "nextOfKinName", s.next_of_kin_phone as "nextOfKinPhone",
      s.next_of_kin_relationship as "nextOfKinRelationship",
      s.next_of_kin_address as "nextOfKinAddress",
      s.state as "province", s.postal_code as "postalCode",
      s.experience_years as "experienceYears", s.max_project_count as "maxProjectCount",
      s.current_project_count as "currentProjectCount",
        (SELECT STRING_AGG(p.project_name, ', ' ORDER BY p.project_name)
         FROM staff_projects sp JOIN projects p ON p.id = sp.project_id
         WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames",
      s.working_hours as "workingHours", s.weekly_hours as "weeklyHours",
      s.available_weekends as "availableWeekends", s.available_nights as "availableNights",
      s.time_zone as "timeZone", s.contract_type as "contractType",
      s.reports_to as "reportsTo", s.notice_period_days as "noticePeriodDays",
      s.hourly_rate as "hourlyRate", s.salary as "salaryAmount", s.salary_grade as "salaryGrade",
      s.uif_status as "uifStatus", s.uif_number as "uifNumber",
      s.coida_status as "coidaStatus", s.tax_status as "taxStatus", s.tax_number as "taxNumber",
      s.probation_status as "probationStatus", s.probation_end_date as "probationEndDate",
      s.probation_extended as "probationExtended",
      s.probation_extension_reason as "probationExtensionReason",
      s.notice_period as "noticePeriod", s.exit_type as "exitType",
      s.exit_reason as "exitReason", s.is_rehireable as "isRehireable",
      s.join_date as "startDate"
    FROM staff s WHERE s.id = ${staffId}
  `) as StaffRow[];

  if (rows.length === 0 || !rows[0]) return null;
  const access = await checkStaffAccess(requestingUserId, staffId);
  return filterStaffFields(rows[0], access);
}

// ---------------------------------------------------------------------------
// List query helpers — one explicit branch per filter combination.
// The SELECT columns are identical across all branches (Neon restriction).
// ---------------------------------------------------------------------------

async function listAll(sql: SqlClient): Promise<StaffRow[]> {
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p.project_name, ', ' ORDER BY p.project_name)
       FROM staff_projects sp JOIN projects p ON p.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listByStatus(sql: SqlClient, status: string): Promise<StaffRow[]> {
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p.project_name, ', ' ORDER BY p.project_name)
       FROM staff_projects sp JOIN projects p ON p.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE s.status = ${status}
    ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listByPosition(sql: SqlClient, position: string): Promise<StaffRow[]> {
  const p = `%${position}%`;
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p2.project_name, ', ' ORDER BY p2.project_name)
       FROM staff_projects sp JOIN projects p2 ON p2.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE LOWER(s.position) LIKE LOWER(${p})
    ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listByDept(sql: SqlClient, dept: string): Promise<StaffRow[]> {
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p.project_name, ', ' ORDER BY p.project_name)
       FROM staff_projects sp JOIN projects p ON p.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE s.department = ${dept}
    ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listByDeptStatus(sql: SqlClient, dept: string, status: string): Promise<StaffRow[]> {
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p.project_name, ', ' ORDER BY p.project_name)
       FROM staff_projects sp JOIN projects p ON p.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE s.department = ${dept} AND s.status = ${status}
    ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listByDeptStatusPos(sql: SqlClient, dept: string, status: string, pos: string): Promise<StaffRow[]> {
  const p = `%${pos}%`;
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p2.project_name, ', ' ORDER BY p2.project_name)
       FROM staff_projects sp JOIN projects p2 ON p2.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE s.department = ${dept} AND s.status = ${status}
      AND LOWER(s.position) LIKE LOWER(${p})
    ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listBySearch(sql: SqlClient, search: string): Promise<StaffRow[]> {
  const t = `%${search}%`;
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p.project_name, ', ' ORDER BY p.project_name)
       FROM staff_projects sp JOIN projects p ON p.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE (
      LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE LOWER(${t}) OR
      LOWER(s.first_name) LIKE LOWER(${t}) OR LOWER(s.last_name) LIKE LOWER(${t}) OR
      LOWER(s.email) LIKE LOWER(${t}) OR LOWER(s.employee_id) LIKE LOWER(${t})
    ) ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listBySearchDept(sql: SqlClient, search: string, dept: string): Promise<StaffRow[]> {
  const t = `%${search}%`;
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p.project_name, ', ' ORDER BY p.project_name)
       FROM staff_projects sp JOIN projects p ON p.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE (
      LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE LOWER(${t}) OR
      LOWER(s.first_name) LIKE LOWER(${t}) OR LOWER(s.last_name) LIKE LOWER(${t}) OR
      LOWER(s.email) LIKE LOWER(${t}) OR LOWER(s.employee_id) LIKE LOWER(${t})
    ) AND s.department = ${dept}
    ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listBySearchDeptStatus(sql: SqlClient, search: string, dept: string, status: string): Promise<StaffRow[]> {
  const t = `%${search}%`;
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p.project_name, ', ' ORDER BY p.project_name)
       FROM staff_projects sp JOIN projects p ON p.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE (
      LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE LOWER(${t}) OR
      LOWER(s.first_name) LIKE LOWER(${t}) OR LOWER(s.last_name) LIKE LOWER(${t}) OR
      LOWER(s.email) LIKE LOWER(${t}) OR LOWER(s.employee_id) LIKE LOWER(${t})
    ) AND s.department = ${dept} AND s.status = ${status}
    ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

async function listBySearchDeptStatusPos(sql: SqlClient, search: string, dept: string, status: string, pos: string): Promise<StaffRow[]> {
  const t = `%${search}%`;
  const p = `%${pos}%`;
  return (await sql`
    SELECT s.*, CONCAT(s.first_name, ' ', s.last_name) as name,
      CONCAT(s.first_name, ' ', s.last_name) as full_name,
      s.employee_id as "employeeId", s.current_project_count as "currentProjectCount",
      (SELECT STRING_AGG(p2.project_name, ', ' ORDER BY p2.project_name)
       FROM staff_projects sp JOIN projects p2 ON p2.id = sp.project_id
       WHERE sp.staff_id = s.id AND sp.is_active = true) as "projectNames"
    FROM staff s WHERE (
      LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE LOWER(${t}) OR
      LOWER(s.first_name) LIKE LOWER(${t}) OR LOWER(s.last_name) LIKE LOWER(${t}) OR
      LOWER(s.email) LIKE LOWER(${t}) OR LOWER(s.employee_id) LIKE LOWER(${t})
    ) AND s.department = ${dept} AND s.status = ${status}
      AND LOWER(s.position) LIKE LOWER(${p})
    ORDER BY s.first_name ASC, s.last_name ASC
  `) as StaffRow[];
}

/**
 * Fetch the staff list applying the provided filter combination.
 * Returns access-filtered rows based on the requesting user's permissions.
 */
export async function getStaffList(filters: StaffListFilters, requestingUserId: string): Promise<StaffRow[]> {
  const sql = getSql();
  const search = Array.isArray(filters.search) ? filters.search[0] : filters.search;
  const dept = Array.isArray(filters.department) ? filters.department[0] : filters.department;
  const status = Array.isArray(filters.status) ? filters.status[0] : filters.status;
  const pos = Array.isArray(filters.position) ? filters.position[0] : filters.position;

  let rows: StaffRow[];

  if (search && dept && status && pos) {
    rows = await listBySearchDeptStatusPos(sql, search, dept, status, pos);
  } else if (search && dept && status) {
    rows = await listBySearchDeptStatus(sql, search, dept, status);
  } else if (search && dept) {
    rows = await listBySearchDept(sql, search, dept);
  } else if (search) {
    rows = await listBySearch(sql, search);
  } else if (dept && status && pos) {
    rows = await listByDeptStatusPos(sql, dept, status, pos);
  } else if (dept && status) {
    rows = await listByDeptStatus(sql, dept, status);
  } else if (dept) {
    rows = await listByDept(sql, dept);
  } else if (status) {
    rows = await listByStatus(sql, status);
  } else if (pos) {
    rows = await listByPosition(sql, pos);
  } else {
    rows = await listAll(sql);
  }

  log.info('Staff list query', { filters, count: rows.length });
  const access = await checkStaffAccess(requestingUserId);
  return filterStaffList(rows, access);
}
