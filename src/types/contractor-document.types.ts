/**
 * Contractor Document Types
 * Simplified types for document management
 */

export interface ContractorDocument {
  id: string;
  contractorId: string;

  // Document Info
  documentType: DocumentType;
  documentName: string;
  documentNumber?: string;

  // File Info
  fileName: string;
  filePath: string; // Firebase Storage path
  fileUrl: string; // Download URL
  fileSize?: number;
  mimeType?: string;

  // Validity
  issueDate?: Date;
  expiryDate?: Date;
  isExpired: boolean;
  daysUntilExpiry?: number;

  // Verification
  isVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: Date;
  verificationNotes?: string;

  // Status
  status: DocumentStatus;
  rejectionReason?: string;

  // Metadata
  notes?: string;
  tags?: string[];

  // Audit
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentType =
  // Company Registration & Legal
  | 'company_registration'
  | 'cipc_registration'
  | 'directors_ids'

  // Tax & Compliance
  | 'tax_clearance'
  | 'vat_certificate'

  // B-BBEE
  | 'bee_certificate'

  // Banking
  | 'bank_confirmation'
  | 'bank_statement'

  // Insurance
  | 'insurance_liability'
  | 'insurance_workers_comp'
  | 'coid_registration'

  // Safety & Health
  | 'sheq_documentation'
  | 'safety_certificate'

  // Technical
  | 'technical_certification'
  | 'key_staff_credentials'

  // Contracts
  | 'signed_contract'
  | 'msa'
  | 'ncnda'

  // Other
  | 'other';

export type DocumentStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'replaced';

// Document type labels for UI
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  company_registration: 'Company Registration',
  cipc_registration: 'CIPC Registration',
  directors_ids: "Directors' IDs",
  tax_clearance: 'Tax Clearance Certificate',
  vat_certificate: 'VAT Certificate',
  bee_certificate: 'B-BBEE Certificate',
  bank_confirmation: 'Bank Confirmation Letter',
  bank_statement: 'Bank Statement',
  insurance_liability: 'Public Liability Insurance',
  insurance_workers_comp: 'Workers Compensation Insurance',
  coid_registration: 'COID Registration',
  sheq_documentation: 'SHEQ Documentation',
  safety_certificate: 'Safety Certificate',
  technical_certification: 'Technical Certification',
  key_staff_credentials: 'Key Staff Credentials',
  signed_contract: 'Signed Contract',
  msa: 'Master Build Agreement',
  ncnda: 'NCNDA',
  other: 'Other Document',
};

// Document types grouped by category (for UI dropdowns)
export const DOCUMENT_TYPE_CATEGORIES = {
  'Company & Legal': [
    'company_registration',
    'cipc_registration',
    'directors_ids',
  ] as DocumentType[],
  'Tax & Compliance': [
    'tax_clearance',
    'vat_certificate',
    'bee_certificate',
  ] as DocumentType[],
  'Banking & Financial': [
    'bank_confirmation',
    'bank_statement',
  ] as DocumentType[],
  'Insurance': [
    'insurance_liability',
    'insurance_workers_comp',
    'coid_registration',
  ] as DocumentType[],
  'Safety & Technical': [
    'sheq_documentation',
    'safety_certificate',
    'technical_certification',
    'key_staff_credentials',
  ] as DocumentType[],
  'Contracts': [
    'signed_contract',
    'msa',
    'ncnda',
  ] as DocumentType[],
  'Other': ['other'] as DocumentType[],
};

// Status colors for badges
export const STATUS_COLORS: Record<DocumentStatus, string> = {
  pending: 'yellow',
  approved: 'green',
  rejected: 'red',
  expired: 'red',
  replaced: 'gray',
};
