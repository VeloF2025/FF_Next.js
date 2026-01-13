/**
 * Staff Form Types - Form data structures and UI types
 */

import {
  Position, Department, StaffLevel, StaffStatus, ContractType, Skill,
  SAContractType, UIFStatus, COIDAStatus, TaxStatus, ProbationStatus, NoticePeriod,
  WorkingHoursCategory, ExitType
} from './enums.types';

export interface StaffFormData {
  id?: string; // For editing
  name: string;
  email: string;
  phone: string;
  alternativePhone?: string;
  employeeId: string;
  position: Position | string;
  department: Department | string; // Allow string for new departments
  level?: StaffLevel;
  bio?: string;
  specializations?: string[];
  status: StaffStatus;
  managerId?: string;
  reportsTo?: string; // Employee ID of manager
  skills: Skill[];
  experienceYears: number;
  address: string;
  city: string;
  province: string;
  postalCode: string;

  // Emergency Contact
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;

  // Next of Kin
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelationship?: string;
  nextOfKinAddress?: string;

  // Identity Documents
  saIdNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
  passportExpiry?: Date;

  startDate: Date;
  endDate?: Date;
  /** @deprecated Use saContractType instead */
  contractType: ContractType;
  /** SA Labour Law compliant contract type */
  saContractType?: SAContractType;
  salaryGrade?: string;
  hourlyRate?: number;
  workingHours: string;
  availableWeekends: boolean;
  availableNights: boolean;
  timeZone: string;
  maxProjectCount: number;
  notes?: string;

  // Compensation
  salaryAmount?: number;
  benefitsPackage?: string;
  noticePeriodDays?: number;

  // Bank Details
  bankName?: string;
  bankAccountNumber?: string;
  bankBranchCode?: string;
  bankAccountType?: string;
  taxNumber?: string;

  // SA Labour Compliance Fields (flattened for form)
  // UIF
  uifStatus?: UIFStatus;
  uifNumber?: string;
  // COIDA
  coidaStatus?: COIDAStatus;
  // Tax
  taxStatus?: TaxStatus;
  // Probation
  probationStatus?: ProbationStatus;
  probationStartDate?: Date;
  probationEndDate?: Date;
  probationExtended?: boolean;
  probationExtensionReason?: string;
  // Notice Period
  noticePeriod?: NoticePeriod;
  customNoticePeriodDays?: number;
  // Working Hours
  workingHoursCategory?: WorkingHoursCategory;
  weeklyHours?: number;
  // Contract Dates
  contractEndDate?: Date;
  contractRenewalDate?: Date;
  // SA Identity
  idNumber?: string;
  workPermitNumber?: string;
  workPermitExpiry?: Date;

  // Exit/Termination Data (for former employees)
  exitType?: ExitType;
  exitReason?: string;
  isRehireable?: boolean;
}

// Dropdown Data Types for UI
export interface StaffDropdownOption {
  id: string;
  name: string;
  email: string;
  position: Position | string;
  department: Department;
  level?: StaffLevel; // Optional for backward compatibility
  status: StaffStatus;
  currentProjectCount: number;
  maxProjectCount: number;
}

// Filter Types
export interface StaffFilter {
  department?: Department[];
  level?: StaffLevel[];
  status?: StaffStatus[];
  skills?: Skill[];
  /** @deprecated Use saContractType instead */
  contractType?: ContractType[];
  /** SA Labour Law compliant contract type filter */
  saContractType?: SAContractType[];
  /** Filter by employee vs contractor */
  isEmployee?: boolean;
  managerId?: string;
  city?: string;
  province?: string;
  availableWeekends?: boolean;
  availableNights?: boolean;
  searchTerm?: string;
  /** Include former employees (resigned/terminated/retired) */
  includeFormerEmployees?: boolean;
}