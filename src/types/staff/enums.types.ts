/**
 * Staff Enums - All enumeration types for staff management
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

// Department Enums
export enum Department {
  MANAGEMENT = 'management',
  PROJECT_MANAGEMENT = 'project_management',
  FIELD_OPERATIONS = 'field_operations',
  NETWORK_OPERATIONS = 'network_operations',
  ENGINEERING = 'engineering',
  INSTALLATION = 'installation',
  MAINTENANCE = 'maintenance',
  QUALITY_ASSURANCE = 'quality_assurance',
  TECHNICAL_SUPPORT = 'technical_support',
  SALES = 'sales',
  CUSTOMER_SERVICE = 'customer_service',
  LOGISTICS = 'logistics',
  ADMINISTRATION = 'administration',
  FINANCE = 'finance',
  HR = 'hr',
  IT = 'it',
  SAFETY = 'safety',
}

// Position enum for standardized roles
export enum Position {
  PROJECT_MANAGER = 'Project Manager',
  SENIOR_PROJECT_MANAGER = 'Senior Project Manager',
  SITE_SUPERVISOR = 'Site Supervisor',
  FIELD_TECHNICIAN = 'Field Technician',
  SENIOR_TECHNICIAN = 'Senior Technician',
  CABLE_JOINTER = 'Cable Jointer',
  FIBRE_SPLICER = 'Fibre Splicer',
  NETWORK_ENGINEER = 'Network Engineer',
  QUALITY_INSPECTOR = 'Quality Inspector',
  SAFETY_OFFICER = 'Safety Officer',
  TEAM_LEAD = 'Team Lead',
  OPERATIONS_MANAGER = 'Operations Manager',
  CONSTRUCTION_MANAGER = 'Construction Manager',
  LOGISTICS_COORDINATOR = 'Logistics Coordinator',
  ADMIN_ASSISTANT = 'Administrative Assistant',
  DATA_CAPTURER = 'Data Capturer',
  DRIVER = 'Driver',
  GENERAL_WORKER = 'General Worker',
  INTERN = 'Intern',
  OTHER = 'Other'
}

// Keep StaffLevel for backward compatibility but mark as deprecated
/**
 * @deprecated Use Position enum instead
 */
export enum StaffLevel {
  INTERN = 'intern',
  JUNIOR = 'junior',
  INTERMEDIATE = 'intermediate',
  SENIOR = 'senior',
  LEAD = 'lead',
  MANAGER = 'manager',
  SENIOR_MANAGER = 'senior_manager',
  DIRECTOR = 'director',
  EXECUTIVE = 'executive',
}

export enum StaffStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ON_LEAVE = 'on_leave',
  SUSPENDED = 'suspended',
  TERMINATED = 'terminated',
  RESIGNED = 'resigned',
  RETIRED = 'retired',
}

/**
 * Exit types for employment termination
 * Used to categorize why an employee left the company
 */
export enum ExitType {
  VOLUNTARY = 'voluntary',           // Employee resigned
  INVOLUNTARY = 'involuntary',       // Terminated by company
  RETIREMENT = 'retirement',         // Retired
  CONTRACT_END = 'contract_end',     // Fixed-term contract ended
  MUTUAL_AGREEMENT = 'mutual',       // Mutual separation agreement
  DEATH = 'death',                   // Deceased
  ABSCONDED = 'absconded',           // Employee abandoned job
}

export const EXIT_TYPE_LABELS: Record<ExitType, string> = {
  [ExitType.VOLUNTARY]: 'Voluntary Resignation',
  [ExitType.INVOLUNTARY]: 'Terminated by Company',
  [ExitType.RETIREMENT]: 'Retirement',
  [ExitType.CONTRACT_END]: 'Contract End',
  [ExitType.MUTUAL_AGREEMENT]: 'Mutual Separation',
  [ExitType.DEATH]: 'Deceased',
  [ExitType.ABSCONDED]: 'Absconded',
};

/**
 * Exit data for staff members who have left the company
 */
export interface StaffExitData {
  exitType: ExitType;
  exitReason: string;
  endDate: string;  // ISO date string
  isRehireable: boolean;
  exitProcessedBy?: string;  // Staff ID who processed the exit
  exitProcessedDate?: string;  // ISO timestamp
}

/**
 * Check if a staff status indicates the employee has left
 */
export function isFormerEmployee(status: StaffStatus): boolean {
  return [
    StaffStatus.TERMINATED,
    StaffStatus.RESIGNED,
    StaffStatus.RETIRED,
  ].includes(status);
}

/**
 * Get the appropriate exit type based on status
 */
export function getExitTypeForStatus(status: StaffStatus): ExitType | null {
  switch (status) {
    case StaffStatus.RESIGNED:
      return ExitType.VOLUNTARY;
    case StaffStatus.TERMINATED:
      return ExitType.INVOLUNTARY;
    case StaffStatus.RETIRED:
      return ExitType.RETIREMENT;
    default:
      return null;
  }
}

/**
 * @deprecated Use SAContractType from './compliance.types' instead.
 * This enum is kept for backward compatibility with existing data.
 * New code should use SAContractType which aligns with SA labour law.
 */
export enum ContractType {
  PERMANENT = 'permanent',
  CONTRACT = 'contract',
  TEMPORARY = 'temporary',
  FREELANCE = 'freelance',
  INTERN = 'intern',
  CONSULTANT = 'consultant',
}

// Re-export SA-compliant contract types for convenience
export {
  SAContractType,
  SA_CONTRACT_TYPE_LABELS,
  UIFStatus,
  UIF_STATUS_LABELS,
  COIDAStatus,
  COIDA_STATUS_LABELS,
  TaxStatus,
  TAX_STATUS_LABELS,
  ProbationStatus,
  PROBATION_STATUS_LABELS,
  NoticePeriod,
  NOTICE_PERIOD_LABELS,
  WorkingHoursCategory,
  WORKING_HOURS_LABELS,
  SA_CONTRACT_CONFIG,
  getContractConfig,
  isEmployee,
  getDefaultCompliance,
  mapLegacyContractType,
} from './compliance.types';

export type {
  SAComplianceData,
  ContractTypeConfig,
} from './compliance.types';

export enum Skill {
  // Technical Skills
  FIBRE_SPLICING = 'fibre_splicing',
  OTDR_TESTING = 'otdr_testing',
  POWER_METER_TESTING = 'power_meter_testing',
  CABLE_INSTALLATION = 'cable_installation',
  POLE_INSTALLATION = 'pole_installation',
  TRENCHING = 'trenching',
  DUCT_INSTALLATION = 'duct_installation',
  
  // Network Skills
  NETWORK_DESIGN = 'network_design',
  NETWORK_CONFIGURATION = 'network_configuration',
  TROUBLESHOOTING = 'troubleshooting',
  MAINTENANCE = 'maintenance',
  
  // Project Management
  PROJECT_MANAGEMENT = 'project_management',
  TEAM_LEADERSHIP = 'team_leadership',
  PLANNING = 'planning',
  COORDINATION = 'coordination',
  
  // Safety and Compliance
  SAFETY_PROTOCOLS = 'safety_protocols',
  QUALITY_CONTROL = 'quality_control',
  COMPLIANCE = 'compliance',
  
  // Customer Service
  CUSTOMER_RELATIONS = 'customer_relations',
  COMMUNICATION = 'communication',
  PROBLEM_SOLVING = 'problem_solving',
}

// Certification Types
export interface Certification {
  name: string;
  issuedBy: string;
  issuedDate: Timestamp;
  expiryDate?: Timestamp;
  certificateNumber?: string;
  status: CertificationStatus;
}

export enum CertificationStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  PENDING_RENEWAL = 'pending_renewal',
  SUSPENDED = 'suspended',
}

// Equipment Types
export interface Equipment {
  id: string;
  name: string;
  type: EquipmentType;
  serialNumber?: string;
  assignedDate: Timestamp;
  condition: EquipmentCondition;
  returnDate?: Timestamp;
}

export enum EquipmentType {
  VEHICLE = 'vehicle',
  TOOL = 'tool',
  TESTING_DEVICE = 'testing_device',
  SAFETY_EQUIPMENT = 'safety_equipment',
  LAPTOP = 'laptop',
  PHONE = 'phone',
  TABLET = 'tablet',
  OTHER = 'other',
}

export enum EquipmentCondition {
  NEW = 'new',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
  DAMAGED = 'damaged',
  NEEDS_REPAIR = 'needs_repair',
}

// Training Types
export interface TrainingRecord {
  id: string;
  trainingName: string;
  trainingType: TrainingType;
  provider: string;
  completedDate: Timestamp;
  expiryDate?: Timestamp;
  certificateUrl?: string;
  score?: number;
  status: TrainingStatus;
}

export enum TrainingType {
  SAFETY = 'safety',
  TECHNICAL = 'technical',
  MANAGEMENT = 'management',
  COMPLIANCE = 'compliance',
  SOFT_SKILLS = 'soft_skills',
  CERTIFICATION = 'certification',
}

export enum TrainingStatus {
  COMPLETED = 'completed',
  IN_PROGRESS = 'in_progress',
  SCHEDULED = 'scheduled',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}