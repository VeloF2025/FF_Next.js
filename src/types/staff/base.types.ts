/**
 * Staff Base Types - Core staff member definitions
 */

import { Timestamp } from 'firebase/firestore';
import {
  Department, Position, StaffLevel, StaffStatus, ContractType,
  Skill, Certification, Equipment, TrainingRecord,
  SAContractType, SAComplianceData, ExitType
} from './enums.types';

export interface StaffMember {
  id?: string;
  
  // Personal Information
  name: string;
  email: string;
  phone: string;
  alternativePhone?: string;
  
  // Employment Details
  employeeId: string;
  position: Position | string; // Allow Position enum or custom string
  department: Department;
  level?: StaffLevel; // Optional for backward compatibility
  status: StaffStatus;
  isActive?: boolean;
  lastActiveDate?: Timestamp;
  
  // Manager/Reporting
  managerId?: string;
  managerName?: string;
  managerPosition?: string;
  managerEmployeeId?: string;
  reportsTo?: string;
  
  // Skills and Certifications
  skills: Skill[];
  certifications: Certification[];
  experienceYears: number;
  specializations: string[];
  
  // Contact Information
  address: string;
  city: string;
  province: string;
  postalCode: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;

  // Next of Kin (separate from emergency contact)
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelationship?: string;
  nextOfKinAddress?: string;
  
  // Employment Terms
  startDate: Timestamp;
  endDate?: Timestamp;
  /** @deprecated Use saContractType instead */
  contractType: ContractType;
  /** SA Labour Law compliant contract type */
  saContractType?: SAContractType;
  salaryGrade?: string;
  hourlyRate?: number;
  taxNumber?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranchCode?: string;
  bankAccountType?: 'current' | 'savings' | 'transmission';
  salaryAmount?: number;
  benefitsPackage?: string;
  noticePeriodDays?: number;

  // SA Identity Documents
  saIdNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
  passportExpiry?: Timestamp | string;
  nationality?: string;

  // Probation
  probationEndDate?: Timestamp;
  probationExtended?: boolean;
  probationExtensionReason?: string;

  // SA Labour Compliance
  /** South African labour law compliance data */
  saCompliance?: SAComplianceData;
  /** True if staff member is an employee (not independent contractor) */
  isEmployee?: boolean;
  /** Currently in probation period */
  inProbation?: boolean;
  /** All required compliance fields are completed */
  complianceComplete?: boolean;

  // Exit/Termination Data (for former employees)
  /** Type of exit - voluntary, involuntary, retirement, etc. */
  exitType?: ExitType;
  /** Detailed reason for leaving */
  exitReason?: string;
  /** Whether the employee can be rehired */
  isRehireable?: boolean;
  /** Staff ID of person who processed the exit */
  exitProcessedBy?: string;
  /** When the exit was processed */
  exitProcessedDate?: Timestamp;

  // Availability and Scheduling
  workingHours: string;
  workLocation?: string;
  workSchedule?: string;
  availableWeekends: boolean;
  availableNights: boolean;
  timeZone: string;
  
  // Project Assignments (current active projects)
  activeProjectIds: string[];
  currentProjectCount: number;
  maxProjectCount: number;
  
  // Performance Metrics
  totalProjectsCompleted: number;
  averageProjectRating: number;
  onTimeCompletionRate: number;
  performanceRating?: number;
  
  // Equipment and Tools
  assignedEquipment: Equipment[];
  vehicleAssigned?: string;
  toolsAssigned: string[];
  
  // Training and Development
  trainingRecords: TrainingRecord[];
  nextTrainingDue?: Timestamp;
  safetyTrainingExpiry?: Timestamp;
  
  // Notes and Comments
  notes?: string;
  performanceNotes?: string;
  
  // Audit Fields
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  lastModifiedBy: string;
  
  // Profile & Photo Verification
  profilePhotoUrl?: string;
  bio?: string;
  /** Photo extracted from ID document (SA ID or Passport) via OCR */
  idPhotoUrl?: string;
  /** AI face comparison score (0-100%) between ID photo and profile photo */
  photoMatchScore?: number;
  /** Timestamp of last photo comparison */
  photoVerifiedAt?: Timestamp;

  // CV/Resume
  cvUrl?: string;
  cvUploadedAt?: Timestamp;

  // Company Vehicle Flag
  /** Whether staff is assigned a company vehicle (triggers license requirement) */
  hasCompanyVehicle?: boolean;
}