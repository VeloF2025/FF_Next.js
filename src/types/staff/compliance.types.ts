/**
 * South African Labour Law Compliance Types
 * Based on BCEA, LRA, UIF Act, COIDA, and Income Tax Act
 */

// ============================================
// SA Contract Types (BCEA-compliant)
// ============================================

/**
 * SA Labour Law Compliant Contract Types
 * Based on Basic Conditions of Employment Act classifications
 */
export enum SAContractType {
  /** Indefinite employment with full labour law protections */
  PERMANENT = 'permanent',
  /** Specific duration contract (max 3 years per LRA s198B) */
  FIXED_TERM = 'fixed_term',
  /** Less than 24 hours/week, pro-rata benefits */
  PART_TIME = 'part_time',
  /** Casual/seasonal work (<24 hours/month or <3 months) */
  TEMPORARY = 'temporary',
  /** Self-employed, not an employee under labour law */
  INDEPENDENT_CONTRACTOR = 'independent_contractor',
  /** Skills development role, temporary */
  INTERN = 'intern',
}

/** Human-readable labels for contract types */
export const SA_CONTRACT_TYPE_LABELS: Record<SAContractType, string> = {
  [SAContractType.PERMANENT]: 'Permanent',
  [SAContractType.FIXED_TERM]: 'Fixed-Term Contract',
  [SAContractType.PART_TIME]: 'Part-Time',
  [SAContractType.TEMPORARY]: 'Temporary / Casual',
  [SAContractType.INDEPENDENT_CONTRACTOR]: 'Independent Contractor',
  [SAContractType.INTERN]: 'Intern',
};

// ============================================
// UIF (Unemployment Insurance Fund)
// ============================================

export enum UIFStatus {
  /** Fully registered, contributions active */
  REGISTERED = 'registered',
  /** Registration in progress */
  PENDING = 'pending',
  /** Exempt (<24hrs/month workers) */
  EXEMPT = 'exempt',
  /** Independent contractors - not applicable */
  NOT_APPLICABLE = 'not_applicable',
}

export const UIF_STATUS_LABELS: Record<UIFStatus, string> = {
  [UIFStatus.REGISTERED]: 'Registered',
  [UIFStatus.PENDING]: 'Pending Registration',
  [UIFStatus.EXEMPT]: 'Exempt',
  [UIFStatus.NOT_APPLICABLE]: 'Not Applicable',
};

// ============================================
// COIDA (Compensation for Occupational Injuries)
// ============================================

export enum COIDAStatus {
  /** Employer has valid coverage */
  COVERED = 'covered',
  /** Coverage being arranged */
  PENDING = 'pending',
  /** Independent contractors (own cover) */
  NOT_APPLICABLE = 'not_applicable',
}

export const COIDA_STATUS_LABELS: Record<COIDAStatus, string> = {
  [COIDAStatus.COVERED]: 'Covered',
  [COIDAStatus.PENDING]: 'Pending',
  [COIDAStatus.NOT_APPLICABLE]: 'Not Applicable (Own Cover)',
};

// ============================================
// Tax Status
// ============================================

export enum TaxStatus {
  /** Employer deducts PAYE - for employees */
  PAYE = 'paye',
  /** Self-managed tax - for contractors */
  PROVISIONAL = 'provisional',
}

export const TAX_STATUS_LABELS: Record<TaxStatus, string> = {
  [TaxStatus.PAYE]: 'PAYE (Employer Deducts)',
  [TaxStatus.PROVISIONAL]: 'Provisional Tax (Self-Managed)',
};

// ============================================
// Probation Status
// ============================================

export enum ProbationStatus {
  /** Currently in probation period */
  IN_PROBATION = 'in_probation',
  /** Successfully completed probation */
  COMPLETED = 'completed',
  /** Extended probation (allowed once per BCEA) */
  EXTENDED = 'extended',
  /** For contractors, temps - no probation */
  NOT_APPLICABLE = 'not_applicable',
}

export const PROBATION_STATUS_LABELS: Record<ProbationStatus, string> = {
  [ProbationStatus.IN_PROBATION]: 'In Probation',
  [ProbationStatus.COMPLETED]: 'Completed',
  [ProbationStatus.EXTENDED]: 'Extended',
  [ProbationStatus.NOT_APPLICABLE]: 'Not Applicable',
};

// ============================================
// Notice Period (per BCEA Section 37)
// ============================================

export enum NoticePeriod {
  /** Less than 6 months service */
  ONE_WEEK = '1_week',
  /** 6 months to 1 year service */
  TWO_WEEKS = '2_weeks',
  /** More than 1 year service */
  FOUR_WEEKS = '4_weeks',
  /** As specified in contract (cannot be less than statutory) */
  AS_PER_CONTRACT = 'as_per_contract',
  /** Contractors - no statutory notice */
  NOT_APPLICABLE = 'not_applicable',
}

export const NOTICE_PERIOD_LABELS: Record<NoticePeriod, string> = {
  [NoticePeriod.ONE_WEEK]: '1 Week (<6 months service)',
  [NoticePeriod.TWO_WEEKS]: '2 Weeks (6-12 months service)',
  [NoticePeriod.FOUR_WEEKS]: '4 Weeks (>1 year service)',
  [NoticePeriod.AS_PER_CONTRACT]: 'As Per Contract',
  [NoticePeriod.NOT_APPLICABLE]: 'Not Applicable',
};

// ============================================
// Working Hours Category
// ============================================

export enum WorkingHoursCategory {
  /** 40-45 hours/week */
  FULL_TIME = 'full_time',
  /** Less than 24 hours/week per BCEA */
  PART_TIME = 'part_time',
  /** Shift-based work */
  SHIFT_WORK = 'shift_work',
  /** Flexible arrangement */
  FLEXIBLE = 'flexible',
  /** Contractors set own hours */
  NOT_APPLICABLE = 'not_applicable',
}

export const WORKING_HOURS_LABELS: Record<WorkingHoursCategory, string> = {
  [WorkingHoursCategory.FULL_TIME]: 'Full-Time (40-45 hrs/week)',
  [WorkingHoursCategory.PART_TIME]: 'Part-Time (<24 hrs/week)',
  [WorkingHoursCategory.SHIFT_WORK]: 'Shift Work',
  [WorkingHoursCategory.FLEXIBLE]: 'Flexible',
  [WorkingHoursCategory.NOT_APPLICABLE]: 'Not Applicable',
};

// ============================================
// Compliance Data Interface
// ============================================

/**
 * SA Compliance Data for Staff Member
 */
export interface SAComplianceData {
  // UIF Compliance
  uifStatus: UIFStatus;
  uifNumber?: string;
  uifRegistrationDate?: Date | string;

  // COIDA Compliance
  coidaStatus: COIDAStatus;

  // Tax Compliance
  taxStatus: TaxStatus;

  // Probation Tracking (BCEA allows up to 6 months, extendable once)
  probationStatus: ProbationStatus;
  probationStartDate?: Date | string;
  probationEndDate?: Date | string;
  probationExtended?: boolean;
  probationExtensionReason?: string;

  // Notice Period
  noticePeriod: NoticePeriod;
  customNoticePeriodDays?: number;

  // Contract Dates
  contractEndDate?: Date | string;
  contractRenewalDate?: Date | string;

  // Working Hours
  workingHoursCategory: WorkingHoursCategory;
  weeklyHours?: number;

  // SA Specific Identity
  idNumber?: string;
  passportNumber?: string;
  workPermitNumber?: string;
  workPermitExpiry?: Date | string;
}

// ============================================
// Contract Type Configuration
// ============================================

/**
 * Configuration defining requirements per contract type
 */
export interface ContractTypeConfig {
  contractType: SAContractType;
  /** True if protected by BCEA/LRA */
  isEmployee: boolean;
  /** Whether UIF registration is required */
  requiresUIF: boolean;
  /** Whether COIDA coverage is required */
  requiresCOIDA: boolean;
  /** Whether employer must deduct PAYE */
  requiresPAYE: boolean;
  /** Whether probation period applies */
  hasProbation: boolean;
  /** Whether statutory notice period applies */
  hasNoticePeriod: boolean;
  /** Whether contract end date is required */
  requiresEndDate: boolean;
  /** Maximum probation months allowed */
  maxProbationMonths: number;
  /** Description for display */
  description: string;
}

/**
 * Configuration map for SA contract types
 * Defines compliance requirements per type based on SA labour law
 */
export const SA_CONTRACT_CONFIG: Record<SAContractType, ContractTypeConfig> = {
  [SAContractType.PERMANENT]: {
    contractType: SAContractType.PERMANENT,
    isEmployee: true,
    requiresUIF: true,
    requiresCOIDA: true,
    requiresPAYE: true,
    hasProbation: true,
    hasNoticePeriod: true,
    requiresEndDate: false,
    maxProbationMonths: 6,
    description: 'Indefinite employment with full labour law protections',
  },
  [SAContractType.FIXED_TERM]: {
    contractType: SAContractType.FIXED_TERM,
    isEmployee: true,
    requiresUIF: true,
    requiresCOIDA: true,
    requiresPAYE: true,
    hasProbation: true,
    hasNoticePeriod: true,
    requiresEndDate: true,
    maxProbationMonths: 3,
    description: 'Fixed duration contract (max 3 years per LRA s198B)',
  },
  [SAContractType.PART_TIME]: {
    contractType: SAContractType.PART_TIME,
    isEmployee: true,
    requiresUIF: true, // If > 24 hours/month
    requiresCOIDA: true,
    requiresPAYE: true,
    hasProbation: true,
    hasNoticePeriod: true,
    requiresEndDate: false,
    maxProbationMonths: 6,
    description: 'Part-time employment (<24 hours/week) with pro-rata benefits',
  },
  [SAContractType.TEMPORARY]: {
    contractType: SAContractType.TEMPORARY,
    isEmployee: true,
    requiresUIF: false, // Exempt if < 24 hours/month
    requiresCOIDA: true,
    requiresPAYE: true,
    hasProbation: false,
    hasNoticePeriod: true,
    requiresEndDate: true,
    maxProbationMonths: 0,
    description: 'Casual/seasonal work (<24 hours/month or <3 months duration)',
  },
  [SAContractType.INDEPENDENT_CONTRACTOR]: {
    contractType: SAContractType.INDEPENDENT_CONTRACTOR,
    isEmployee: false,
    requiresUIF: false,
    requiresCOIDA: false, // Own cover required
    requiresPAYE: false, // Provisional tax
    hasProbation: false,
    hasNoticePeriod: false,
    requiresEndDate: true, // Contract term
    maxProbationMonths: 0,
    description: 'Independent contractor - not an employee, manages own tax and insurance',
  },
  [SAContractType.INTERN]: {
    contractType: SAContractType.INTERN,
    isEmployee: true,
    requiresUIF: true,
    requiresCOIDA: true,
    requiresPAYE: true,
    hasProbation: false,
    hasNoticePeriod: true,
    requiresEndDate: true,
    maxProbationMonths: 0,
    description: 'Internship program - temporary developmental role',
  },
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get the configuration for a given contract type
 */
export function getContractConfig(contractType: SAContractType): ContractTypeConfig {
  return SA_CONTRACT_CONFIG[contractType];
}

/**
 * Check if a contract type represents an employee (vs contractor)
 */
export function isEmployee(contractType: SAContractType): boolean {
  return SA_CONTRACT_CONFIG[contractType].isEmployee;
}

/**
 * Get default compliance values based on contract type
 */
export function getDefaultCompliance(contractType: SAContractType): Partial<SAComplianceData> {
  const config = SA_CONTRACT_CONFIG[contractType];

  return {
    uifStatus: config.requiresUIF ? UIFStatus.PENDING : UIFStatus.NOT_APPLICABLE,
    coidaStatus: config.requiresCOIDA ? COIDAStatus.PENDING : COIDAStatus.NOT_APPLICABLE,
    taxStatus: config.requiresPAYE ? TaxStatus.PAYE : TaxStatus.PROVISIONAL,
    probationStatus: config.hasProbation ? ProbationStatus.IN_PROBATION : ProbationStatus.NOT_APPLICABLE,
    noticePeriod: config.hasNoticePeriod ? NoticePeriod.AS_PER_CONTRACT : NoticePeriod.NOT_APPLICABLE,
    workingHoursCategory: contractType === SAContractType.PART_TIME
      ? WorkingHoursCategory.PART_TIME
      : contractType === SAContractType.INDEPENDENT_CONTRACTOR
        ? WorkingHoursCategory.NOT_APPLICABLE
        : WorkingHoursCategory.FULL_TIME,
  };
}

/**
 * Map legacy ContractType values to new SAContractType
 */
export function mapLegacyContractType(legacyType: string): SAContractType {
  const mapping: Record<string, SAContractType> = {
    // Legacy values from old system
    permanent: SAContractType.PERMANENT,
    'full-time': SAContractType.PERMANENT,
    fulltime: SAContractType.PERMANENT,
    contract: SAContractType.FIXED_TERM,
    'fixed-term': SAContractType.FIXED_TERM,
    temporary: SAContractType.TEMPORARY,
    freelance: SAContractType.INDEPENDENT_CONTRACTOR,
    consultant: SAContractType.INDEPENDENT_CONTRACTOR,
    intern: SAContractType.INTERN,
    // New SAContractType values map to themselves
    fixed_term: SAContractType.FIXED_TERM,
    part_time: SAContractType.PART_TIME,
    independent_contractor: SAContractType.INDEPENDENT_CONTRACTOR,
  };

  return mapping[legacyType.toLowerCase()] || SAContractType.PERMANENT;
}
