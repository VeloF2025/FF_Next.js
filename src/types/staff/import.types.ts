/**
 * Staff Import Types - CSV/Excel import data structures
 */

import { StaffMember } from './base.types';

export interface StaffImportRow {
  name: string;
  email: string;
  phone?: string;
  alternativePhone?: string;
  employeeId?: string;
  idNumber?: string;           // SA ID Number
  position?: string;
  department?: string;
  level?: string;
  status?: string;
  skills?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  startDate?: string;
  contractType?: string;
  workingHours?: string;
  managerName?: string;
  salary?: string;             // Salary/Rate
}

export interface StaffImportResult {
  success: boolean;
  total: number;
  imported: number;
  failed: number;
  errors: StaffImportError[];
  staffMembers: StaffMember[];
}

export interface StaffImportError {
  row: number;
  field: string;
  message: string;
  value?: unknown;
}