/**
 * Contractor Verification Types
 * Types for CIPC company verification, SA ID validation, and background checks
 */

// ==================== STATUS & TYPE ENUMS ====================

export type VerificationStatus = 'pending' | 'passed' | 'failed' | 'warning' | 'error';

export type VerificationType =
  | 'cipc_company'
  | 'id_verification'
  | 'id_photo'
  | 'criminal_record'
  | 'pep_sanctions'
  | 'qualification'
  | 'drivers_license'
  | 'adverse_news';

export type VerificationBundle = 'basic' | 'standard' | 'enhanced' | 'full_due_diligence';

export type DirectorRole = 'director' | 'staff' | 'key_person';

// ==================== SA ID VALIDATION ====================

// SaIdValidationResult is defined in @/lib/saIdValidation.ts (standalone, no circular deps)
export type { SaIdValidationResult } from '@/lib/saIdValidation';

// ==================== SEARCHWORKS / CIPC TYPES ====================

export interface SearchWorksDirector {
  fullName: string;
  firstName: string;
  surname: string;
  idNumber: string;
  dateOfBirth: string | null;
  gender: string | null;
  age: number | null;
  status: string;
  type: string;
  appointmentDate: string | null;
  resignationDate: string | null;
  residentialAddress: string | null;
  postalAddress: string | null;
}

export interface SearchWorksCompanyResult {
  companyName: string;
  registrationNumber: string;
  companyType: string;
  status: string;
  registrationDate: string | null;
  taxNumber: string | null;
  financialYearEnd: string | null;
  principalDescription: string | null;
  registeredAddress: string | null;
  postalAddress: string | null;
  activeDirectors: SearchWorksDirector[];
  resignedDirectors: SearchWorksDirector[];
  deceasedDirectors: SearchWorksDirector[];
  sarsVerification: {
    tradingName: string | null;
    vatNumber: string | null;
    area: string | null;
  } | null;
}

export interface IdVerificationResult {
  verified: boolean;
  idNumber: string;
  fullName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  deceased: boolean | null;
}

export interface IdPhotoResult {
  verified: boolean;
  idNumber: string;
  matchScore: number | null;
  photoUrl: string | null;
}

export interface CriminalCheckResult {
  clear: boolean;
  idNumber: string;
  fullName: string;
  checkDate: string;
  records: Array<{
    offence: string;
    date: string;
    court: string;
    sentence: string;
  }>;
}

export interface PepSanctionsResult {
  clear: boolean;
  idNumber: string;
  fullName: string;
  pepMatch: boolean;
  sanctionsMatch: boolean;
  details: string | null;
}

// ==================== VERIFICATION CHECK ====================

export interface VerificationCheck {
  field: string;
  status: VerificationStatus;
  expected: string | null;
  actual: string | null;
  message: string;
}

// ==================== CONTRACTOR DIRECTOR ====================

export interface ContractorDirector {
  id: string;
  contractorId: string;
  fullName: string;
  idNumber: string;
  idType: 'sa_id' | 'passport' | 'other';
  idValid: boolean | null;
  idDateOfBirth: string | null;
  idGender: string | null;
  idCitizenship: string | null;
  cipcMatched: boolean | null;
  cipcDirectorStatus: string | null;
  cipcAppointmentDate: string | null;
  criminalCheckStatus: VerificationStatus | null;
  criminalCheckDate: string | null;
  criminalCheckClear: boolean | null;
  idPhotoVerified: boolean | null;
  idPhotoVerifiedDate: string | null;
  pepSanctionsClear: boolean | null;
  pepSanctionsDate: string | null;
  isPrimary: boolean;
  role: DirectorRole;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================== VERIFICATION RECORD ====================

export interface ContractorVerification {
  id: string;
  contractorId: string;
  directorId: string | null;
  verificationType: VerificationType;
  status: VerificationStatus;
  inputData: Record<string, unknown> | null;
  resultData: Record<string, unknown> | null;
  apiCostCents: number | null;
  apiProvider: string | null;
  apiRequestId: string | null;
  verifiedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================== API REQUEST / RESPONSE ====================

export interface VerifyContractorRequest {
  contractorId: string;
  bundle: VerificationBundle;
}

export interface VerifyContractorResponse {
  contractorId: string;
  companyVerification: {
    status: VerificationStatus;
    companyResult: SearchWorksCompanyResult | null;
    checks: VerificationCheck[];
    directorMatches: Array<{
      enteredName: string;
      enteredId: string;
      cipcMatch: SearchWorksDirector | null;
      matchType: 'id_exact' | 'name_fuzzy' | 'no_match';
    }>;
  };
  individualChecks: ContractorVerification[];
  overallStatus: VerificationStatus;
  totalCostCents: number;
}

export interface IndividualCheckRequest {
  contractorId: string;
  directorId: string;
  checkType: VerificationType;
}

export interface IndividualCheckResult {
  verification: ContractorVerification;
  director: ContractorDirector;
}

// ==================== COST ESTIMATION ====================
// Runtime cost utilities are in @/lib/verificationCosts.ts
// Import from there directly to avoid bundler initialization issues
