/**
 * Staff Import Types
 * Type definitions for staff import/export operations
 */

// Header mapping for CSV columns
export interface HeaderMapping {
  [key: string]: string;
}

/**
 * Normalize a header string for consistent matching
 * Converts to lowercase, removes spaces/underscores, trims whitespace
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, ''); // Remove spaces, underscores, hyphens
}

/**
 * Header mapping using normalized keys
 * Maps normalized header names to StaffImportRow field names
 */
const NORMALIZED_HEADER_MAP: Record<string, string> = {
  // Name variations
  'name': 'name',
  'fullname': 'name',
  'staffname': 'name',
  'employeename': 'name',

  // First/Last name (will be combined into name)
  'firstname': 'firstName',
  'first': 'firstName',
  'givenname': 'firstName',
  'lastname': 'lastName',
  'last': 'lastName',
  'surname': 'lastName',
  'familyname': 'lastName',

  // Email
  'email': 'email',
  'emailaddress': 'email',
  'mail': 'email',
  'workemail': 'email',

  // Phone
  'phone': 'phone',
  'phonenumber': 'phone',
  'mobile': 'phone',
  'cellphone': 'phone',
  'cell': 'phone',
  'contact': 'phone',
  'contactnumber': 'phone',

  // Employee ID
  'employeeid': 'employeeId',
  'empid': 'employeeId',
  'staffid': 'employeeId',
  'id': 'employeeId',
  'employeenumber': 'employeeId',
  'empno': 'employeeId',
  'staffno': 'employeeId',

  // ID Number (SA ID)
  'idnumber': 'idNumber',
  'idno': 'idNumber',
  'nationalid': 'idNumber',
  'identitynumber': 'idNumber',
  'said': 'idNumber',

  // Position
  'position': 'position',
  'jobtitle': 'position',
  'title': 'position',
  'role': 'position',
  'designation': 'position',

  // Department
  'department': 'department',
  'dept': 'department',
  'team': 'department',
  'division': 'department',
  'primarygroup': 'department',
  'group': 'department',

  // Manager
  'reportsto': 'managerName',
  'manager': 'managerName',
  'managername': 'managerName',
  'supervisor': 'managerName',
  'linemanager': 'managerName',

  // Status
  'status': 'status',
  'employmentstatus': 'status',

  // Skills
  'skills': 'skills',
  'skill': 'skills',
  'competencies': 'skills',

  // Address
  'address': 'address',
  'streetaddress': 'address',
  'street': 'address',

  // City
  'city': 'city',
  'town': 'city',

  // Province
  'province': 'province',
  'state': 'province',
  'region': 'province',

  // Postal Code
  'postalcode': 'postalCode',
  'postcode': 'postalCode',
  'zipcode': 'postalCode',
  'zip': 'postalCode',

  // Emergency Contact
  'emergencycontactname': 'emergencyContactName',
  'emergencycontact': 'emergencyContactName',
  'emergencyname': 'emergencyContactName',
  'nextofkin': 'emergencyContactName',
  'emergencycontactphone': 'emergencyContactPhone',
  'emergencyphone': 'emergencyContactPhone',
  'emergencynumber': 'emergencyContactPhone',

  // Start Date
  'startdate': 'startDate',
  'hiredate': 'startDate',
  'joindate': 'startDate',
  'datejoined': 'startDate',
  'employmentdate': 'startDate',
  'commencementdate': 'startDate',

  // Contract Type
  'contracttype': 'contractType',
  'employmenttype': 'contractType',
  'contract': 'contractType',
  'type': 'contractType',

  // Working Hours
  'workinghours': 'workingHours',
  'hours': 'workingHours',
  'workhours': 'workingHours',

  // Alternative Phone
  'alternativephone': 'alternativePhone',
  'altphone': 'alternativePhone',
  'secondaryphone': 'alternativePhone',
  'homephone': 'alternativePhone',

  // Salary
  'salary': 'salary',
  'rate': 'salary',
  'hourlyrate': 'salary',
  'monthlyrate': 'salary',
  'pay': 'salary',

  // Level
  'level': 'level',
  'grade': 'level',
  'joblevel': 'level',
};

/**
 * Get the mapped field name for a header
 * @param header - The original header from the file
 * @returns The mapped field name or the normalized header if no mapping exists
 */
export function getFieldNameFromHeader(header: string): string {
  const normalized = normalizeHeader(header);
  return NORMALIZED_HEADER_MAP[normalized] || normalized;
}

/**
 * Map a row object with original headers to standardized field names
 * @param row - Object with original header keys
 * @returns Object with standardized field names
 */
export function mapRowHeaders(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const fieldName = getFieldNameFromHeader(key);
    mapped[fieldName] = value;
  }

  // Handle firstName + lastName -> name combination
  if (mapped['firstName'] && mapped['lastName']) {
    mapped['name'] = `${mapped['firstName']} ${mapped['lastName']}`.trim();
  } else if (mapped['firstName'] && !mapped['name']) {
    mapped['name'] = String(mapped['firstName']);
  } else if (mapped['lastName'] && !mapped['name']) {
    mapped['name'] = String(mapped['lastName']);
  }

  return mapped;
}

// Legacy DEFAULT_HEADER_MAPPING for backward compatibility
// This is now generated from NORMALIZED_HEADER_MAP
export const DEFAULT_HEADER_MAPPING: HeaderMapping = Object.entries(NORMALIZED_HEADER_MAP).reduce(
  (acc, [normalized, field]) => {
    // Add common case variations
    acc[normalized] = field;
    acc[normalized.charAt(0).toUpperCase() + normalized.slice(1)] = field; // Title case
    acc[normalized.toUpperCase()] = field; // UPPER CASE
    return acc;
  },
  {} as HeaderMapping
);

// Import template columns
export const IMPORT_TEMPLATE_COLUMNS = [
  'employee id',
  'name',
  'email',
  'phone',
  'position',
  'department',
  'reports to',
  'address',
  'city',
  'province',
  'postalCode',
  'start date'
];

// Export columns configuration
export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}