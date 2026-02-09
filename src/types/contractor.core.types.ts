/**
 * Contractor Core Types - Clean rewrite (Oct 30, 2025)
 *
 * This is the MINIMAL contractor interface - identity and contact info only.
 * Separated concerns (built as separate modules):
 * - RAG scoring → src/modules/rag/
 * - Teams → src/modules/teams/
 * - Documents → src/modules/documents/
 * - Onboarding → src/modules/onboarding/
 * - Project stats → Calculated on-demand
 */

// ==================== CORE CONTRACTOR INTERFACE ====================

export interface Contractor {
  id: string;

  // Company Information (5 fields)
  companyName: string;
  registrationNumber: string;
  businessType: BusinessType;
  industryCategory: string;
  yearsInBusiness?: number;

  // Contact Information (4 fields)
  contactPerson: string;
  email: string;
  phone: string;
  alternatePhone?: string;

  // Address (4 fields)
  physicalAddress?: string;
  city?: string;
  province?: string;
  postalCode?: string;

  // Financial - For payment purposes only (3 fields)
  bankName?: string;
  accountNumber?: string;
  branchCode?: string;

  // Status (3 fields)
  status: ContractorStatus;
  isActive: boolean;
  complianceStatus: ComplianceStatus;

  // Professional (2 fields)
  specializations?: string[];
  certifications?: string[];

  // Verification (4 fields)
  cipcVerified?: boolean;
  cipcVerifiedAt?: Date;
  cipcCompanyStatus?: string;
  verificationBundle?: string;

  // Metadata (4 fields)
  notes?: string;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ==================== ENUMS & TYPES ====================

export type BusinessType =
  | 'pty_ltd'           // (Pty) Ltd
  | 'cc'                // Close Corporation
  | 'sole_proprietor'   // Sole Proprietor
  | 'partnership';      // Partnership

export type ContractorStatus =
  | 'pending'           // Awaiting approval
  | 'approved'          // Active and approved
  | 'suspended'         // Temporarily suspended
  | 'blacklisted'       // Permanently blocked
  | 'under_review';     // Being reviewed

export type ComplianceStatus =
  | 'compliant'         // All docs valid
  | 'non_compliant'     // Missing/expired docs
  | 'under_review'      // Being verified
  | 'pending';          // Not yet checked

// ==================== FORM DATA ====================

export interface ContractorFormData {
  // Company
  companyName: string;
  registrationNumber: string;
  businessType: BusinessType;
  industryCategory: string;
  yearsInBusiness?: number;

  // Contact
  contactPerson: string;
  email: string;
  phone: string;
  alternatePhone?: string;

  // Address
  physicalAddress?: string;
  city?: string;
  province?: string;
  postalCode?: string;

  // Financial
  bankName?: string;
  accountNumber?: string;
  branchCode?: string;

  // Status
  status?: ContractorStatus;
  isActive?: boolean;
  complianceStatus?: ComplianceStatus;

  // Professional
  specializations?: string[];
  certifications?: string[];

  // Metadata
  notes?: string;
  tags?: string[];
}

// ==================== FILTERS ====================

export interface ContractorFilter {
  searchTerm?: string;
  status?: ContractorStatus[];
  complianceStatus?: ComplianceStatus[];
  businessType?: BusinessType[];
  province?: string[];
  hasActiveProjects?: boolean;
  tags?: string[];
}

// ==================== ANALYTICS ====================

export interface ContractorAnalytics {
  totalContractors: number;
  byStatus: {
    pending: number;
    approved: number;
    suspended: number;
    blacklisted: number;
    under_review: number;
  };
  byCompliance: {
    compliant: number;
    non_compliant: number;
    under_review: number;
    pending: number;
  };
  byBusinessType: {
    pty_ltd: number;
    cc: number;
    sole_proprietor: number;
    partnership: number;
  };
}

// ==================== CONSTANTS ====================

export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'pty_ltd', label: '(Pty) Ltd' },
  { value: 'cc', label: 'Close Corporation' },
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'partnership', label: 'Partnership' },
];

export const CONTRACTOR_STATUSES: { value: ContractorStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'yellow' },
  { value: 'approved', label: 'Approved', color: 'green' },
  { value: 'suspended', label: 'Suspended', color: 'red' },
  { value: 'blacklisted', label: 'Blacklisted', color: 'red' },
  { value: 'under_review', label: 'Under Review', color: 'blue' },
];

export const COMPLIANCE_STATUSES: { value: ComplianceStatus; label: string; color: string }[] = [
  { value: 'compliant', label: 'Compliant', color: 'green' },
  { value: 'non_compliant', label: 'Non-Compliant', color: 'red' },
  { value: 'under_review', label: 'Under Review', color: 'blue' },
  { value: 'pending', label: 'Pending', color: 'yellow' },
];

export const SA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
];

// ==================== VALIDATION ====================

export const CONTRACTOR_VALIDATION = {
  companyName: {
    minLength: 2,
    maxLength: 255,
    required: true,
  },
  registrationNumber: {
    pattern: /^[A-Z0-9\/-]+$/i,
    required: true,
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    required: true,
  },
  phone: {
    pattern: /^[+\d\s()-]+$/,
    minLength: 10,
    required: true,
  },
};
