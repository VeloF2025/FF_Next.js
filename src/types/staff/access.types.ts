/**
 * Staff Access Control Types
 * Defines field classifications for sensitive data access control
 */

/**
 * Permission key for sensitive staff data
 */
export const STAFF_SENSITIVE_PERMISSION = 'people.staff.sensitive';

/**
 * Fields that require sensitive data access
 * These are only visible to HR admins or self-viewing
 */
export const SENSITIVE_FIELDS = [
  // Compensation
  'salary',
  'salaryAmount',
  'hourly_rate',
  'hourlyRate',
  'salary_grade',
  'salaryGrade',

  // Bank details
  'bank_name',
  'bankName',
  'bank_account_number',
  'bankAccountNumber',
  'bank_branch_code',
  'bankBranchCode',
  'bank_account_type',
  'bankAccountType',
  'bank_account_holder',
  'bankAccountHolder',
  'bank_details_verified_at',
  'bankDetailsVerifiedAt',
  'bank_verified_by',
  'bankVerifiedBy',

  // Identity documents
  'sa_id_number',
  'saIdNumber',
  'id_number',
  'idNumber',
  'passport_number',
  'passportNumber',
  'passport_country',
  'passportCountry',
  'passport_expiry',
  'passportExpiry',
  'work_permit_number',
  'workPermitNumber',
  'work_permit_expiry',
  'workPermitExpiry',
  'id_photo_url',
  'idPhotoUrl',

  // Tax & compliance
  'tax_number',
  'taxNumber',
  'tax_status',
  'taxStatus',
  'uif_number',
  'uifNumber',
  'uif_status',
  'uifStatus',
  'coida_status',
  'coidaStatus',

  // Emergency contacts & next of kin
  'emergency_contact',
  'emergencyContact',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelationship',
  'emergency_contact_relationship',
  'next_of_kin_name',
  'nextOfKinName',
  'next_of_kin_phone',
  'nextOfKinPhone',
  'next_of_kin_relationship',
  'nextOfKinRelationship',
  'next_of_kin_address',
  'nextOfKinAddress',

  // Exit details
  'exit_type',
  'exitType',
  'exit_reason',
  'exitReason',
  'is_rehireable',
  'isRehireable',
  'exit_processed_by',
  'exitProcessedBy',
  'exit_processed_date',
  'exitProcessedDate',

  // Probation
  'probation_status',
  'probationStatus',
  'probation_end_date',
  'probationEndDate',
  'probation_extended',
  'probationExtended',
  'probation_extension_reason',
  'probationExtensionReason',
] as const;

/**
 * Fields visible to all authenticated users (limited access)
 * Used for staff selection dropdowns, project assignments, etc.
 */
export const LIMITED_FIELDS = [
  // Basic identity
  'id',
  'employee_id',
  'employeeId',
  'first_name',
  'firstName',
  'last_name',
  'lastName',
  'name',
  'full_name',
  'fullName',
  'email',
  'phone',
  'whatsapp_id',
  'whatsappId',
  'profile_photo_url',
  'profilePhotoUrl',

  // Employment basics
  'position',
  'department',
  'department_id',
  'departmentId',
  'level',
  'status',
  'join_date',
  'joinDate',
  'startDate',
  'end_date',
  'endDate',
  'contract_type',
  'contractType',

  // Work info (non-sensitive)
  'experience_years',
  'experienceYears',
  'skills',
  'specializations',
  'bio',
  'notes',
  'reports_to',
  'reportsTo',
  'managerName',

  // Availability
  'max_project_count',
  'maxProjectCount',
  'current_project_count',
  'currentProjectCount',
  'working_hours',
  'workingHours',
  'weekly_hours',
  'weeklyHours',
  'available_weekends',
  'availableWeekends',
  'available_nights',
  'availableNights',
  'time_zone',
  'timeZone',

  // License status (needed for driver selection)
  'license_status',
  'licenseStatus',
  'license_expiry',
  'licenseExpiry',
  'has_valid_license',
  'hasValidLicense',

  // Address (non-sensitive)
  'address',
  'city',
  'state',
  'province',
  'postal_code',
  'postalCode',

  // Timestamps
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
] as const;

/**
 * Staff access level type
 */
export type StaffAccessLevel = 'full' | 'limited' | 'self';

/**
 * Staff access check result
 */
export interface StaffAccessResult {
  /** The access level granted */
  level: StaffAccessLevel;
  /** User has full sensitive data access */
  canViewSensitive: boolean;
  /** User can edit sensitive data (HR admins only) */
  canEditSensitive: boolean;
  /** The user is viewing their own staff record */
  isSelfView: boolean;
}
