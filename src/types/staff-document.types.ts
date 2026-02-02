/**
 * Staff Document Types
 * Full HR Package: ID, licenses, contracts, certifications, qualifications, medical certs
 */

export type DocumentType =
  | 'sa_id'
  | 'passport'
  | 'drivers_license'
  | 'employment_contract'
  | 'certification'
  | 'qualification'
  | 'medical_certificate'
  | 'police_clearance'
  | 'bank_details'
  | 'tax_document'
  | 'other';

export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'expired';

export interface StaffDocument {
  id: string;
  staffId: string;
  documentType: DocumentType;
  documentName: string;
  fileUrl: string;
  fileUrlFront?: string;  // For multi-file documents (e.g., driver's license front)
  fileUrlBack?: string;   // For multi-file documents (e.g., driver's license back)
  fileSize?: number;
  mimeType?: string;
  expiryDate?: string;
  issuedDate?: string;
  issuingAuthority?: string;
  documentNumber?: string;
  verificationStatus: VerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  verificationNotes?: string;
  createdAt: string;
  updatedAt: string;
  // OCR-extracted metadata (pending sync to staff table on verification)
  ocrMetadata?: OcrMetadata;
  // Joined data
  verifier?: {
    id: string;
    name: string;
  };
  staff?: {
    id: string;
    name: string;
  };
}

/**
 * OCR-extracted metadata structure
 * Fields vary by document type - all optional
 */
export interface OcrMetadata {
  // SA ID
  saIdNumber?: string;
  // Passport
  passportNumber?: string;
  passportExpiry?: string;
  passportCountry?: string;
  // Driver's License
  driversLicenseNumber?: string;
  driversLicenseExpiry?: string;
  driversLicenseCodes?: string;
  // Bank Details
  bankName?: string;
  bankAccountNumber?: string;
  bankBranchCode?: string;
  bankAccountType?: string;
  bankAccountHolder?: string;
  // Generic fields
  fullName?: string;
  dateOfBirth?: string;
  [key: string]: string | undefined;
}

export interface StaffDocumentUpload {
  staffId: string;
  documentType: DocumentType;
  documentName: string;
  file: File;
  expiryDate?: string;
  issuedDate?: string;
  issuingAuthority?: string;
  documentNumber?: string;
}

export interface StaffDocumentCreate {
  staffId: string;
  documentType: DocumentType;
  documentName: string;
  fileUrl: string;
  fileUrlFront?: string;  // For multi-file documents
  fileUrlBack?: string;   // For multi-file documents
  fileSize?: number;
  mimeType?: string;
  expiryDate?: string;
  issuedDate?: string;
  issuingAuthority?: string;
  documentNumber?: string;
}

export interface StaffDocumentUpdate {
  documentName?: string;
  expiryDate?: string;
  issuedDate?: string;
  issuingAuthority?: string;
  documentNumber?: string;
}

export interface DocumentVerification {
  status: 'verified' | 'rejected';
  notes?: string;
  /** Edited OCR metadata to save before syncing to staff table */
  ocrMetadata?: OcrMetadata;
}

export interface DocumentExpiryAlert {
  id: string;
  staffDocumentId: string;
  alertDate: string;
  alertType: '30_day' | '7_day' | 'expired';
  isSent: boolean;
  sentAt?: string;
  createdAt: string;
  // Joined data
  document?: StaffDocument;
}

export interface ComplianceStatus {
  staffId: string;
  totalDocuments: number;
  verifiedDocuments: number;
  pendingDocuments: number;
  rejectedDocuments: number;
  expiredDocuments: number;
  expiringIn30Days: number;
  expiringIn7Days: number;
  missingRequired: DocumentType[];
  compliancePercentage: number;
  status: 'compliant' | 'warning' | 'non_compliant';
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  sa_id: 'SA ID Document',
  passport: 'Passport',
  drivers_license: "Driver's License",
  employment_contract: 'Employment Contract',
  certification: 'Industry Certification',
  qualification: 'Educational Qualification',
  medical_certificate: 'Medical Certificate',
  police_clearance: 'Police Clearance',
  bank_details: 'Banking Details',
  tax_document: 'Tax Document',
  other: 'Other'
};

export const DOCUMENT_TYPE_ICONS: Record<DocumentType, string> = {
  sa_id: 'IdCard',
  passport: 'BookOpen',
  drivers_license: 'Car',
  employment_contract: 'FileText',
  certification: 'Award',
  qualification: 'GraduationCap',
  medical_certificate: 'Stethoscope',
  police_clearance: 'Shield',
  bank_details: 'Building2',
  tax_document: 'Receipt',
  other: 'File'
};

export const DOCUMENTS_WITH_EXPIRY: DocumentType[] = [
  'passport',
  'drivers_license',
  'medical_certificate',
  'police_clearance',
  'certification'
];

export const REQUIRED_DOCUMENTS: DocumentType[] = [
  'sa_id',
  'employment_contract'
];

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  pending: 'Pending Review',
  verified: 'Verified',
  rejected: 'Rejected',
  expired: 'Expired'
};

export const VERIFICATION_STATUS_COLORS: Record<VerificationStatus, string> = {
  pending: 'yellow',
  verified: 'green',
  rejected: 'red',
  expired: 'gray'
};

// Document categories for grouping in UI
export const DOCUMENT_CATEGORIES = {
  identity: ['sa_id', 'passport', 'drivers_license', 'police_clearance'] as DocumentType[],
  employment: ['employment_contract', 'bank_details', 'tax_document'] as DocumentType[],
  qualifications: ['certification', 'qualification', 'medical_certificate'] as DocumentType[],
  other: ['other'] as DocumentType[]
};

export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  identity: 'Identity & Verification',
  employment: 'Employment & Financial',
  qualifications: 'Qualifications & Certifications',
  other: 'Other Documents'
};

// ============================================================
// Document Upload Categories (Type-First Flow)
// ============================================================

/**
 * Documents that support OCR data extraction
 * These will go through the OCR processing flow
 */
export const OCR_ENABLED_DOCUMENTS: DocumentType[] = [
  'sa_id',
  'passport',
  'drivers_license',
  'employment_contract',
  'bank_details',
  'tax_document',
];

/**
 * Documents that are upload-only (no OCR extraction)
 * These skip OCR and go directly to manual entry
 */
export const UPLOAD_ONLY_DOCUMENTS: DocumentType[] = [
  'police_clearance',
  'medical_certificate',
  'certification',
  'qualification',
  'other',
];

/**
 * Documents that require multiple file uploads
 * Key is document type, value is array of file identifiers
 * Note: Driver's license simplified to single file (front only) - Jan 2026
 */
export const MULTI_FILE_DOCUMENTS: Partial<Record<DocumentType, string[]>> = {
  // Currently no document types require multiple files
};

/**
 * Check if a document type supports OCR extraction
 */
export function isOcrEnabled(documentType: DocumentType): boolean {
  return OCR_ENABLED_DOCUMENTS.includes(documentType);
}

/**
 * Check if a document type requires multiple files
 */
export function isMultiFileDocument(documentType: DocumentType): boolean {
  return documentType in MULTI_FILE_DOCUMENTS;
}

/**
 * Get the file parts required for a document type
 */
export function getMultiFileParts(documentType: DocumentType): string[] {
  return MULTI_FILE_DOCUMENTS[documentType] || ['file'];
}

/**
 * Document type descriptions for the selection UI
 */
export const DOCUMENT_TYPE_DESCRIPTIONS: Record<DocumentType, string> = {
  sa_id: 'South African ID or Smart ID Card',
  passport: 'For travel or foreign nationals',
  drivers_license: 'Driver\'s license front page',
  employment_contract: 'Employment agreement or service contract',
  certification: 'Industry certifications (e.g., fibre splicing)',
  qualification: 'Degrees, diplomas, or training certificates',
  medical_certificate: 'Medical fitness certificate',
  police_clearance: 'Criminal record check certificate',
  bank_details: 'Bank confirmation letter or statement',
  tax_document: 'IRP5, IT3a, or tax clearance certificate',
  other: 'Any other relevant document',
};

/**
 * Fields to extract per document type (for OCR-enabled documents)
 */
export const DOCUMENT_EXTRACTION_FIELDS: Partial<Record<DocumentType, string[]>> = {
  sa_id: ['idNumber', 'fullName', 'dateOfBirth', 'gender', 'nationality', 'issueDate'],
  passport: ['passportNumber', 'fullName', 'dateOfBirth', 'nationality', 'issueDate', 'expiryDate', 'issuingCountry'],
  drivers_license: ['licenseNumber', 'idNumber', 'fullName', 'dateOfBirth', 'licenseCodes', 'restrictions', 'validFrom', 'validTo'],
  employment_contract: ['startDate', 'endDate', 'contractType', 'position'],
  bank_details: ['bankName', 'accountNumber', 'branchCode', 'accountType'],
  tax_document: ['taxNumber'],
};

// ============================================================
// VF Storage Integration (PRD-021)
// ============================================================

/**
 * VF Storage server configuration
 * Note: baseUrl is internal for server-to-server; use publicUrl for browser-facing URLs
 */
export const VF_STORAGE_CONFIG = {
  baseUrl: 'http://100.96.203.105:8091', // Internal (server-to-server)
  publicUrl: 'https://vf.fibreflow.app', // Public (browser-facing)
  endpoints: {
    upload: '/upload',
    list: '/list',
    delete: '/delete',
    health: '/health',
  },
  staffDocumentsPath: 'staff/documents',
};

/**
 * Allowed file types for upload
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const ALLOWED_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif',
  '.doc', '.docx', '.xls', '.xlsx',
];

/**
 * Maximum file size (10MB)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Check if a file type is allowed
 */
export function isAllowedFileType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType);
}

/**
 * Check if a file size is within limit
 */
export function isFileSizeValid(size: number): boolean {
  return size <= MAX_FILE_SIZE;
}

/**
 * Get human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * VF Storage upload response
 */
export interface VFStorageUploadResponse {
  success: boolean;
  filename: string;
  path: string;
  url: string;
  size: number;
}

/**
 * VF Storage file list response
 */
export interface VFStorageFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

/**
 * Required documents for employees (SA Labour Law)
 */
export const REQUIRED_DOCUMENTS_EMPLOYEE: DocumentType[] = [
  'sa_id',
  'employment_contract',
  'tax_document',
];

/**
 * Required documents for contractors
 */
export const REQUIRED_DOCUMENTS_CONTRACTOR: DocumentType[] = [
  'sa_id',
  'employment_contract', // Service agreement
  'tax_document',        // Tax clearance
];
