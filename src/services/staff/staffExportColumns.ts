/**
 * Column list for the staff export, widened for callers with sensitive access.
 *
 * Moved verbatim out of staffAccessService when the type-aware document helpers
 * pushed that file past the 300-line limit. Behaviour is unchanged; it is a
 * static list with no dependency on the access checks around it.
 */

import type { StaffAccessResult } from '@/types/staff/access.types';

const BASE_COLUMNS = [
  'Employee ID',
  'Name',
  'Email',
  'Phone',
  'Position',
  'Department',
  'Level',
  'Status',
  'Manager',
  'Skills',
  'Experience Years',
  'Address',
  'City',
  'Province',
  'Postal Code',
  'Start Date',
  'Contract Type',
  'Working Hours',
  'Available Weekends',
  'Available Nights',
  'Current Projects',
  'Max Projects',
];

const SENSITIVE_COLUMNS = [
  'Salary',
  'Hourly Rate',
  'Salary Grade',
  'SA ID Number',
  'Passport Number',
  'Tax Number',
  'UIF Number',
  'Bank Name',
  'Bank Account Number',
  'Bank Branch Code',
  'Emergency Contact Name',
  'Emergency Contact Phone',
  'Next of Kin Name',
  'Next of Kin Phone',
];

/**
 * Export columns for staff export based on access level
 */
export function getExportColumns(access: StaffAccessResult): string[] {
  if (access.canViewSensitive) {
    return [...BASE_COLUMNS, ...SENSITIVE_COLUMNS];
  }
  return [...BASE_COLUMNS];
}
