/**
 * Staff Update Service
 * Handles PUT (update) operations for the staff API.
 * Field extraction is separated from the SQL execution to keep each section
 * focused and readable.
 */

import { getSql } from '@/lib/neon-sql';
import { logUpdate } from '@/lib/db-logger';
import { createLogger } from '@/lib/logger';

const log = createLogger('StaffUpdateService');

/** Raw request body shape accepted by the update endpoint */
export type StaffUpdateInput = Record<string, unknown>;

/** Result returned by updateStaff */
export type StaffUpdateResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; notFound: true };

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

/** Return value if present (including explicit null/empty → null to clear); undefined if absent */
function fv(input: StaffUpdateInput, cc: string, sc?: string): unknown {
  const v = input[cc] ?? (sc ? input[sc] : undefined);
  return v !== undefined ? (v || null) : undefined;
}

/** UUID fields: empty string → null, validate format */
function uv(input: StaffUpdateInput, cc: string, sc?: string): unknown {
  const v = input[cc] ?? (sc ? input[sc] : undefined);
  if (v === undefined) return undefined;
  if (!v || v === '') return null;
  // Validate UUID format to prevent PostgreSQL cast errors
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof v === 'string' && !uuidRegex.test(v)) return null;
  return v;
}

/** Date fields: empty string → null, validate parseable */
function dv(input: StaffUpdateInput, cc: string, sc?: string): unknown {
  const v = input[cc] ?? (sc ? input[sc] : undefined);
  if (v === undefined) return undefined;
  if (!v || v === '') return null;
  // Validate date is parseable to prevent PostgreSQL cast errors
  if (typeof v === 'string' && isNaN(Date.parse(v))) return null;
  return v;
}

/** JSONB fields: array → JSON string */
function jv(input: StaffUpdateInput, key: string): string | undefined {
  if (input[key] === undefined) return undefined;
  return Array.isArray(input[key]) ? JSON.stringify(input[key]) : (input[key] as string);
}

// ---------------------------------------------------------------------------
// Extracted fields type — keeps updateStaff readable
// ---------------------------------------------------------------------------

interface UpdateFields {
  firstName: string; lastName: string;
  isExitUpdate: boolean; exitType: string | null; exitReason: string | null; endDate: string | null;
  alternatePhone: unknown; whatsappId: unknown;
  address: unknown; city: unknown; state: unknown; postalCode: unknown;
  level: unknown; reportsTo: unknown; experienceYears: unknown; contractType: unknown;
  maxProjectCount: unknown; workingHours: unknown; weeklyHours: unknown;
  availableWeekends: unknown; availableNights: unknown; timeZone: unknown; noticePeriodDays: unknown;
  salary: unknown; hourlyRate: unknown; salaryGrade: unknown;
  skills: string | undefined; specializations: string | undefined;
  notes: unknown; bio: unknown;
  saIdNumber: unknown; idNumber: unknown; passportNumber: unknown; passportCountry: unknown;
  passportExpiry: unknown; workPermitNumber: unknown; workPermitExpiry: unknown;
  emergencyContactJson: string | undefined; emergencyContactRelationship: unknown;
  nextOfKinName: unknown; nextOfKinPhone: unknown; nextOfKinRelationship: unknown; nextOfKinAddress: unknown;
  bankName: unknown; bankAccountNumber: unknown; bankBranchCode: unknown; bankAccountType: unknown;
  uifStatus: unknown; uifNumber: unknown; coidaStatus: unknown; taxStatus: unknown; taxNumber: unknown;
  probationStatus: unknown; probationEndDate: unknown; probationExtended: unknown;
  probationExtensionReason: unknown; noticePeriod: unknown;
  isRehireable: boolean | null; exitProcessedBy: string | null;
  departmentId: string | null | undefined;
}

async function extractFields(updates: StaffUpdateInput, sql: ReturnType<typeof getSql>): Promise<UpdateFields> {
  const name = (updates.name as string) ?? '';
  const firstName = (updates.first_name as string) ?? (updates.firstName as string) ?? name.split(' ')[0] ?? '';
  const lastName = (updates.last_name as string) ?? (updates.lastName as string) ?? name.split(' ').slice(1).join(' ') ?? '';
  const ecName = fv(updates, 'emergencyContactName', 'emergency_contact_name');
  const ecPhone = fv(updates, 'emergencyContactPhone', 'emergency_contact_phone');
  const hasEc = ecName !== undefined || ecPhone !== undefined;
  let departmentId: string | null | undefined = (updates.departmentId ?? updates.department_id) as string | null | undefined;
  if (updates.department && departmentId === undefined) {
    const r = (await sql`SELECT id FROM departments WHERE name = ${updates.department as string} AND is_active = true LIMIT 1`) as { id: string }[];
    departmentId = r.length > 0 && r[0] ? r[0].id : null;
  }
  return {
    firstName, lastName,
    isExitUpdate: !!(updates.exitType ?? updates.exit_type),
    exitType: (updates.exitType ?? updates.exit_type ?? null) as string | null,
    exitReason: (updates.exitReason ?? updates.exit_reason ?? null) as string | null,
    endDate: (updates.endDate ?? updates.end_date ?? null) as string | null,
    alternatePhone: fv(updates, 'alternativePhone', 'alternate_phone'),
    whatsappId: fv(updates, 'whatsappId', 'whatsapp_id'),
    address: fv(updates, 'address'), city: fv(updates, 'city'),
    state: updates.province ?? updates.state ?? undefined,
    postalCode: fv(updates, 'postalCode', 'postal_code'),
    level: fv(updates, 'level'), reportsTo: uv(updates, 'reportsTo', 'reports_to'),
    experienceYears: updates.experienceYears ?? updates.experience_years ?? undefined,
    contractType: fv(updates, 'contractType', 'contract_type') ?? fv(updates, 'saContractType'),
    maxProjectCount: updates.maxProjectCount ?? updates.max_project_count ?? undefined,
    workingHours: fv(updates, 'workingHours', 'working_hours'),
    weeklyHours: updates.weeklyHours ?? updates.weekly_hours ?? undefined,
    availableWeekends: updates.availableWeekends ?? updates.available_weekends ?? undefined,
    availableNights: updates.availableNights ?? updates.available_nights ?? undefined,
    timeZone: fv(updates, 'timeZone', 'time_zone'),
    noticePeriodDays: updates.noticePeriodDays ?? updates.notice_period_days ?? undefined,
    salary: updates.salaryAmount ?? updates.salary ?? undefined,
    hourlyRate: updates.hourlyRate ?? updates.hourly_rate ?? undefined,
    salaryGrade: fv(updates, 'salaryGrade', 'salary_grade'),
    skills: jv(updates, 'skills'), specializations: jv(updates, 'specializations'),
    notes: fv(updates, 'notes'), bio: fv(updates, 'bio'),
    saIdNumber: fv(updates, 'saIdNumber', 'sa_id_number'),
    idNumber: fv(updates, 'idNumber', 'id_number'),
    passportNumber: fv(updates, 'passportNumber', 'passport_number'),
    passportCountry: fv(updates, 'passportCountry', 'passport_country'),
    passportExpiry: dv(updates, 'passportExpiry', 'passport_expiry'),
    workPermitNumber: fv(updates, 'workPermitNumber', 'work_permit_number'),
    workPermitExpiry: dv(updates, 'workPermitExpiry', 'work_permit_expiry'),
    emergencyContactJson: hasEc ? JSON.stringify({ name: ecName ?? null, phone: ecPhone ?? null }) : undefined,
    emergencyContactRelationship: fv(updates, 'emergencyContactRelationship', 'emergency_contact_relationship'),
    nextOfKinName: fv(updates, 'nextOfKinName', 'next_of_kin_name'),
    nextOfKinPhone: fv(updates, 'nextOfKinPhone', 'next_of_kin_phone'),
    nextOfKinRelationship: fv(updates, 'nextOfKinRelationship', 'next_of_kin_relationship'),
    nextOfKinAddress: fv(updates, 'nextOfKinAddress', 'next_of_kin_address'),
    bankName: fv(updates, 'bankName', 'bank_name'),
    bankAccountNumber: fv(updates, 'bankAccountNumber', 'bank_account_number'),
    bankBranchCode: fv(updates, 'bankBranchCode', 'bank_branch_code'),
    bankAccountType: fv(updates, 'bankAccountType', 'bank_account_type'),
    uifStatus: fv(updates, 'uifStatus', 'uif_status'), uifNumber: fv(updates, 'uifNumber', 'uif_number'),
    coidaStatus: fv(updates, 'coidaStatus', 'coida_status'),
    taxStatus: fv(updates, 'taxStatus', 'tax_status'), taxNumber: fv(updates, 'taxNumber', 'tax_number'),
    probationStatus: fv(updates, 'probationStatus', 'probation_status'),
    probationEndDate: dv(updates, 'probationEndDate', 'probation_end_date'),
    probationExtended: updates.probationExtended ?? updates.probation_extended ?? undefined,
    probationExtensionReason: fv(updates, 'probationExtensionReason', 'probation_extension_reason'),
    noticePeriod: fv(updates, 'noticePeriod', 'notice_period'),
    isRehireable: (updates.isRehireable ?? updates.is_rehireable ?? null) as boolean | null,
    exitProcessedBy: (updates.exitProcessedBy ?? updates.exit_processed_by ?? null) as string | null,
    departmentId,
  };
}

// ---------------------------------------------------------------------------
// Main update function
// ---------------------------------------------------------------------------

/**
 * Update a staff member record.
 * Returns the updated row (with camelCase aliases) or { notFound: true }.
 */
export async function updateStaff(staffId: string, updates: StaffUpdateInput): Promise<StaffUpdateResult> {
  const sql = getSql();
  const f = await extractFields(updates, sql);
  log.info('updateStaff', { staffId, fields: Object.keys(updates) });

  const rows = (await sql`
    UPDATE staff SET
      first_name = COALESCE(${f.firstName || null}, first_name),
      last_name = COALESCE(${f.lastName || null}, last_name),
      email = COALESCE(${(updates.email as string) ?? null}, email),
      phone = COALESCE(${(updates.phone as string) ?? null}, phone),
      alternate_phone = CASE WHEN ${f.alternatePhone !== undefined} THEN ${f.alternatePhone} ELSE alternate_phone END,
      whatsapp_id = CASE WHEN ${f.whatsappId !== undefined} THEN ${f.whatsappId} ELSE whatsapp_id END,
      address = CASE WHEN ${f.address !== undefined} THEN ${f.address} ELSE address END,
      city = CASE WHEN ${f.city !== undefined} THEN ${f.city} ELSE city END,
      state = CASE WHEN ${f.state !== undefined} THEN ${f.state} ELSE state END,
      postal_code = CASE WHEN ${f.postalCode !== undefined} THEN ${f.postalCode} ELSE postal_code END,
      position = COALESCE(${(updates.position as string) ?? null}, position),
      department = COALESCE(${(updates.department as string) ?? null}, department),
      department_id = CASE WHEN ${f.departmentId !== undefined} THEN ${f.departmentId}::uuid ELSE department_id END,
      status = COALESCE(${(updates.status as string) ?? null}, status),
      level = CASE WHEN ${f.level !== undefined} THEN ${f.level} ELSE level END,
      reports_to = CASE WHEN ${f.reportsTo !== undefined} THEN ${f.reportsTo}::uuid ELSE reports_to END,
      experience_years = CASE WHEN ${f.experienceYears !== undefined} THEN ${f.experienceYears} ELSE experience_years END,
      contract_type = CASE WHEN ${f.contractType !== undefined} THEN ${f.contractType} ELSE contract_type END,
      max_project_count = CASE WHEN ${f.maxProjectCount !== undefined} THEN ${f.maxProjectCount} ELSE max_project_count END,
      working_hours = CASE WHEN ${f.workingHours !== undefined} THEN ${f.workingHours} ELSE working_hours END,
      weekly_hours = CASE WHEN ${f.weeklyHours !== undefined} THEN ${f.weeklyHours} ELSE weekly_hours END,
      available_weekends = CASE WHEN ${f.availableWeekends !== undefined} THEN ${f.availableWeekends} ELSE available_weekends END,
      available_nights = CASE WHEN ${f.availableNights !== undefined} THEN ${f.availableNights} ELSE available_nights END,
      time_zone = CASE WHEN ${f.timeZone !== undefined} THEN ${f.timeZone} ELSE time_zone END,
      notice_period_days = CASE WHEN ${f.noticePeriodDays !== undefined} THEN ${f.noticePeriodDays} ELSE notice_period_days END,
      join_date = COALESCE(${((updates.join_date ?? updates.startDate) as string) ?? null}, join_date),
      end_date = COALESCE(${f.endDate}, end_date),
      salary = CASE WHEN ${f.salary !== undefined} THEN ${f.salary} ELSE salary END,
      hourly_rate = CASE WHEN ${f.hourlyRate !== undefined} THEN ${f.hourlyRate} ELSE hourly_rate END,
      salary_grade = CASE WHEN ${f.salaryGrade !== undefined} THEN ${f.salaryGrade} ELSE salary_grade END,
      skills = CASE WHEN ${f.skills !== undefined} THEN ${f.skills}::jsonb ELSE skills END,
      specializations = CASE WHEN ${f.specializations !== undefined} THEN ${f.specializations}::jsonb ELSE specializations END,
      notes = CASE WHEN ${f.notes !== undefined} THEN ${f.notes} ELSE notes END,
      bio = CASE WHEN ${f.bio !== undefined} THEN ${f.bio} ELSE bio END,
      sa_id_number = CASE WHEN ${f.saIdNumber !== undefined} THEN ${f.saIdNumber} ELSE sa_id_number END,
      id_number = CASE WHEN ${f.idNumber !== undefined} THEN ${f.idNumber} ELSE id_number END,
      passport_number = CASE WHEN ${f.passportNumber !== undefined} THEN ${f.passportNumber} ELSE passport_number END,
      passport_country = CASE WHEN ${f.passportCountry !== undefined} THEN ${f.passportCountry} ELSE passport_country END,
      passport_expiry = CASE WHEN ${f.passportExpiry !== undefined} THEN ${f.passportExpiry}::date ELSE passport_expiry END,
      work_permit_number = CASE WHEN ${f.workPermitNumber !== undefined} THEN ${f.workPermitNumber} ELSE work_permit_number END,
      work_permit_expiry = CASE WHEN ${f.workPermitExpiry !== undefined} THEN ${f.workPermitExpiry}::date ELSE work_permit_expiry END,
      emergency_contact = CASE WHEN ${f.emergencyContactJson !== undefined} THEN ${f.emergencyContactJson}::jsonb ELSE emergency_contact END,
      emergency_contact_relationship = CASE WHEN ${f.emergencyContactRelationship !== undefined} THEN ${f.emergencyContactRelationship} ELSE emergency_contact_relationship END,
      next_of_kin_name = CASE WHEN ${f.nextOfKinName !== undefined} THEN ${f.nextOfKinName} ELSE next_of_kin_name END,
      next_of_kin_phone = CASE WHEN ${f.nextOfKinPhone !== undefined} THEN ${f.nextOfKinPhone} ELSE next_of_kin_phone END,
      next_of_kin_relationship = CASE WHEN ${f.nextOfKinRelationship !== undefined} THEN ${f.nextOfKinRelationship} ELSE next_of_kin_relationship END,
      next_of_kin_address = CASE WHEN ${f.nextOfKinAddress !== undefined} THEN ${f.nextOfKinAddress} ELSE next_of_kin_address END,
      bank_name = CASE WHEN ${f.bankName !== undefined} THEN ${f.bankName} ELSE bank_name END,
      bank_account_number = CASE WHEN ${f.bankAccountNumber !== undefined} THEN ${f.bankAccountNumber} ELSE bank_account_number END,
      bank_branch_code = CASE WHEN ${f.bankBranchCode !== undefined} THEN ${f.bankBranchCode} ELSE bank_branch_code END,
      bank_account_type = CASE WHEN ${f.bankAccountType !== undefined} THEN ${f.bankAccountType} ELSE bank_account_type END,
      uif_status = CASE WHEN ${f.uifStatus !== undefined} THEN ${f.uifStatus} ELSE uif_status END,
      uif_number = CASE WHEN ${f.uifNumber !== undefined} THEN ${f.uifNumber} ELSE uif_number END,
      coida_status = CASE WHEN ${f.coidaStatus !== undefined} THEN ${f.coidaStatus} ELSE coida_status END,
      tax_status = CASE WHEN ${f.taxStatus !== undefined} THEN ${f.taxStatus} ELSE tax_status END,
      tax_number = CASE WHEN ${f.taxNumber !== undefined} THEN ${f.taxNumber} ELSE tax_number END,
      probation_status = CASE WHEN ${f.probationStatus !== undefined} THEN ${f.probationStatus} ELSE probation_status END,
      probation_end_date = CASE WHEN ${f.probationEndDate !== undefined} THEN ${f.probationEndDate}::date ELSE probation_end_date END,
      probation_extended = CASE WHEN ${f.probationExtended !== undefined} THEN ${f.probationExtended} ELSE probation_extended END,
      probation_extension_reason = CASE WHEN ${f.probationExtensionReason !== undefined} THEN ${f.probationExtensionReason} ELSE probation_extension_reason END,
      notice_period = CASE WHEN ${f.noticePeriod !== undefined} THEN ${f.noticePeriod} ELSE notice_period END,
      exit_type = COALESCE(${f.exitType}, exit_type),
      exit_reason = COALESCE(${f.exitReason}, exit_reason),
      is_rehireable = COALESCE(${f.isRehireable}, is_rehireable),
      exit_processed_by = COALESCE(${f.exitProcessedBy}, exit_processed_by),
      exit_processed_date = CASE WHEN ${f.isExitUpdate} THEN NOW() ELSE exit_processed_date END,
      updated_at = NOW()
    WHERE id = ${staffId}
    RETURNING *,
      CONCAT(first_name, ' ', last_name) as name,
      CONCAT(first_name, ' ', last_name) as full_name,
      sa_id_number as "saIdNumber", passport_number as "passportNumber",
      passport_country as "passportCountry", passport_expiry as "passportExpiry",
      whatsapp_id as "whatsappId", alternate_phone as "alternativePhone",
      experience_years as "experienceYears", max_project_count as "maxProjectCount",
      working_hours as "workingHours", weekly_hours as "weeklyHours",
      available_weekends as "availableWeekends", available_nights as "availableNights",
      time_zone as "timeZone", contract_type as "contractType",
      hourly_rate as "hourlyRate", salary_grade as "salaryGrade",
      notice_period_days as "noticePeriodDays",
      emergency_contact->>'name' as "emergencyContactName",
      emergency_contact->>'phone' as "emergencyContactPhone",
      emergency_contact_relationship as "emergencyContactRelationship",
      next_of_kin_name as "nextOfKinName", next_of_kin_phone as "nextOfKinPhone",
      next_of_kin_relationship as "nextOfKinRelationship",
      next_of_kin_address as "nextOfKinAddress",
      bank_name as "bankName", bank_account_number as "bankAccountNumber",
      bank_branch_code as "bankBranchCode", bank_account_type as "bankAccountType",
      uif_status as "uifStatus", uif_number as "uifNumber",
      coida_status as "coidaStatus", tax_status as "taxStatus", tax_number as "taxNumber",
      probation_status as "probationStatus", probation_end_date as "probationEndDate",
      probation_extended as "probationExtended",
      probation_extension_reason as "probationExtensionReason",
      notice_period as "noticePeriod", work_permit_number as "workPermitNumber",
      work_permit_expiry as "workPermitExpiry", id_number as "idNumber",
      reports_to as "reportsTo", state as "province", postal_code as "postalCode",
      salary as "salaryAmount"
  `) as Record<string, unknown>[];

  if (rows.length === 0 || !rows[0]) return { ok: false, notFound: true };

  const updated = rows[0];
  const logData: Record<string, unknown> = { updated_fields: Object.keys(updates), name: updated.full_name };
  if (f.isExitUpdate) { logData.exit_type = f.exitType; logData.exit_status = updates.status; }
  logUpdate('staff', staffId, logData);

  return { ok: true, data: updated };
}
