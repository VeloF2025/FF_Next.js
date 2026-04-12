/**
 * Document Validation Service
 * Compares OCR-extracted data against staff records to detect mismatches
 * Used during document upload and verification to ensure documents belong to the correct person
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

/** OCR-extracted fields from a document. All values are strings or absent. */
export interface OcrDocumentData {
  employeeName?: string;
  fullName?: string;
  firstName?: string;
  surname?: string;
  employeeIdNumber?: string;
  idNumber?: string;
  documentNumber?: string;
  saIdNumber?: string;
  jobTitle?: string;
  position?: string;
  startDate?: string;
  department?: string;
  accountHolder?: string;
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  branchCode?: string;
  [key: string]: string | undefined;
}

export interface ValidationMismatch {
  field: string;
  label: string;
  documentValue: string | null;
  recordValue: string | null;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  matchScore: number; // 0-100 percentage
  mismatches: ValidationMismatch[];
  matches: string[];
  staffRecord: {
    name: string;
    saIdNumber: string | null;
    position: string | null;
    department: string | null;
    startDate: string | null;
  } | null;
}

/**
 * Normalize string for comparison (lowercase, trim, remove extra spaces)
 */
function normalizeString(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Normalize name for comparison (handles different name formats)
 * "John Smith" vs "SMITH, JOHN" vs "J. Smith" etc.
 */
function normalizeNameForComparison(name: string | null | undefined): string[] {
  if (!name) return [];

  const normalized = normalizeString(name);

  // Split into parts and sort alphabetically for comparison
  const parts = normalized
    .replace(/[,\.]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length > 1) // Ignore single letters/initials
    .sort();

  return parts;
}

/**
 * Check if two names are similar enough to be considered a match
 */
function areNamesSimilar(name1: string | null, name2: string | null): boolean {
  const parts1 = normalizeNameForComparison(name1);
  const parts2 = normalizeNameForComparison(name2);

  if (parts1.length === 0 || parts2.length === 0) return false;

  // Check if all significant parts of one name appear in the other
  const matchingParts = parts1.filter(p1 =>
    parts2.some(p2 => p1 === p2 || p1.includes(p2) || p2.includes(p1))
  );

  // Consider a match if at least 2 name parts match, or all parts of shorter name match
  const minParts = Math.min(parts1.length, parts2.length);
  return matchingParts.length >= Math.min(2, minParts);
}

/**
 * Normalize SA ID number (remove spaces, dashes)
 */
function normalizeIdNumber(id: string | null | undefined): string {
  if (!id) return '';
  return id.replace(/[\s\-]/g, '');
}

/**
 * Normalize position/job title for comparison
 */
function normalizePosition(position: string | null | undefined): string {
  if (!position) return '';
  return normalizeString(position)
    .replace(/_/g, ' ')
    .replace(/\bjnr\b/g, 'junior')
    .replace(/\bsnr\b/g, 'senior')
    .replace(/\bsr\b/g, 'senior')
    .replace(/\bjr\b/g, 'junior');
}

/**
 * Format date for display
 */
function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  try {
    const d = new Date(date);
    return d.toISOString().split('T')[0] ?? ''; // YYYY-MM-DD
  } catch {
    return String(date);
  }
}

/**
 * Fetch staff record by ID
 */
async function fetchStaffRecord(staffId: string) {
  try {
    const result = await sql`
      SELECT
        name,
        sa_id_number as "saIdNumber",
        position,
        department,
        join_date as "startDate"
      FROM staff
      WHERE id = ${staffId}::uuid
    `;
    return result[0] || null;
  } catch (err) {
    log.error('Failed to fetch staff record for validation', { staffId, error: err });
    return null;
  }
}

/**
 * Validate employment contract OCR data against staff record
 */
export async function validateEmploymentContract(
  staffId: string,
  ocrData: OcrDocumentData
): Promise<ValidationResult> {
  const mismatches: ValidationMismatch[] = [];
  const matches: string[] = [];

  // Fetch current staff record
  const staffRecord = await fetchStaffRecord(staffId);

  if (!staffRecord) {
    // Return empty validation (no mismatches) when staff record is missing
    // This is not a document problem, just means we can't compare
    return {
      isValid: true,
      matchScore: 100,
      mismatches: [],
      matches: [],
      staffRecord: null,
    };
  }

  // 1. Compare Employee Name (warning - names can have variations)
  const contractName = ocrData.employeeName || ocrData.fullName;
  if (contractName && staffRecord.name) {
    if (areNamesSimilar(contractName, staffRecord.name)) {
      matches.push('Employee Name');
    } else {
      mismatches.push({
        field: 'employeeName',
        label: 'Employee Name',
        documentValue: contractName,
        recordValue: staffRecord.name,
        severity: 'warning',
        message: `Name mismatch: Document shows "${contractName}", record has "${staffRecord.name}"`,
      });
    }
  }

  // 2. Compare ID Number (critical - must match exactly)
  const contractIdNumber = normalizeIdNumber(ocrData.employeeIdNumber || ocrData.idNumber);
  const recordIdNumber = normalizeIdNumber(staffRecord.saIdNumber);

  if (contractIdNumber && recordIdNumber) {
    if (contractIdNumber === recordIdNumber) {
      matches.push('SA ID Number');
    } else {
      mismatches.push({
        field: 'employeeIdNumber',
        label: 'SA ID Number',
        documentValue: ocrData.employeeIdNumber ?? ocrData.idNumber ?? null,
        recordValue: staffRecord.saIdNumber,
        severity: 'critical',
        message: `ID Number mismatch: Document shows "${ocrData.employeeIdNumber || ocrData.idNumber}", record has "${staffRecord.saIdNumber}"`,
      });
    }
  } else if (contractIdNumber && !recordIdNumber) {
    // Contract has ID but staff record doesn't - info only
    mismatches.push({
      field: 'employeeIdNumber',
      label: 'SA ID Number',
      documentValue: ocrData.employeeIdNumber ?? ocrData.idNumber ?? null,
      recordValue: null,
      severity: 'info',
      message: `ID Number "${contractIdNumber}" will be added to staff record on approval`,
    });
  }

  // 3. Compare Position/Job Title (warning - may have variations)
  const contractPosition = normalizePosition(ocrData.jobTitle || ocrData.position);
  const recordPosition = normalizePosition(staffRecord.position);

  if (contractPosition && recordPosition) {
    // Check for partial match (one contains the other)
    const positionMatch = contractPosition.includes(recordPosition) ||
                          recordPosition.includes(contractPosition) ||
                          contractPosition === recordPosition;

    if (positionMatch) {
      matches.push('Position');
    } else {
      mismatches.push({
        field: 'jobTitle',
        label: 'Position',
        documentValue: ocrData.jobTitle ?? ocrData.position ?? null,
        recordValue: staffRecord.position,
        severity: 'warning',
        message: `Position mismatch: Document shows "${ocrData.jobTitle || ocrData.position}", record has "${staffRecord.position}"`,
      });
    }
  }

  // 4. Compare Start Date (warning - could be contract renewal)
  const contractStartDate = formatDate(ocrData.startDate);
  const recordStartDate = formatDate(staffRecord.startDate);

  if (contractStartDate && recordStartDate) {
    if (contractStartDate === recordStartDate) {
      matches.push('Start Date');
    } else {
      mismatches.push({
        field: 'startDate',
        label: 'Start Date',
        documentValue: contractStartDate,
        recordValue: recordStartDate,
        severity: 'info',
        message: `Start date differs: Document shows "${contractStartDate}", record has "${recordStartDate}" (may be contract renewal)`,
      });
    }
  }

  // 5. Compare Department (info only)
  const contractDepartment = normalizeString(ocrData.department);
  const recordDepartment = normalizeString(staffRecord.department);

  if (contractDepartment && recordDepartment) {
    if (contractDepartment === recordDepartment ||
        contractDepartment.includes(recordDepartment) ||
        recordDepartment.includes(contractDepartment)) {
      matches.push('Department');
    } else {
      mismatches.push({
        field: 'department',
        label: 'Department',
        documentValue: ocrData.department ?? null,
        recordValue: staffRecord.department,
        severity: 'info',
        message: `Department differs: Document shows "${ocrData.department}", record has "${staffRecord.department}"`,
      });
    }
  }

  // Calculate match score
  const totalFields = matches.length + mismatches.length;
  const criticalMismatches = mismatches.filter(m => m.severity === 'critical').length;
  const warningMismatches = mismatches.filter(m => m.severity === 'warning').length;

  let matchScore = 100;
  if (totalFields > 0) {
    // Critical mismatches heavily impact score
    matchScore = Math.max(0, Math.round(
      ((matches.length * 100) - (criticalMismatches * 50) - (warningMismatches * 20)) / totalFields
    ));
  }

  // Document is valid if no critical mismatches
  const isValid = criticalMismatches === 0;

  return {
    isValid,
    matchScore,
    mismatches,
    matches,
    staffRecord: {
      name: staffRecord.name,
      saIdNumber: staffRecord.saIdNumber,
      position: staffRecord.position,
      department: staffRecord.department,
      startDate: recordStartDate || null,
    },
  };
}

/**
 * Validate SA ID document against staff record
 */
export async function validateSaIdDocument(
  staffId: string,
  ocrData: OcrDocumentData
): Promise<ValidationResult> {
  const mismatches: ValidationMismatch[] = [];
  const matches: string[] = [];

  const staffRecord = await fetchStaffRecord(staffId);

  if (!staffRecord) {
    // Return empty validation (no mismatches) when staff record is missing
    // This is not a document problem, just means we can't compare
    return {
      isValid: true,
      matchScore: 100,
      mismatches: [],
      matches: [],
      staffRecord: null,
    };
  }

  // Compare ID Number
  const docIdNumber = normalizeIdNumber(ocrData.saIdNumber || ocrData.idNumber || ocrData.documentNumber);
  const recordIdNumber = normalizeIdNumber(staffRecord.saIdNumber);

  if (docIdNumber && recordIdNumber) {
    if (docIdNumber === recordIdNumber) {
      matches.push('SA ID Number');
    } else {
      mismatches.push({
        field: 'saIdNumber',
        label: 'SA ID Number',
        documentValue: ocrData.saIdNumber ?? ocrData.idNumber ?? ocrData.documentNumber ?? null,
        recordValue: staffRecord.saIdNumber,
        severity: 'critical',
        message: `ID Number mismatch: Document shows "${docIdNumber}", record has "${recordIdNumber}"`,
      });
    }
  }

  // Compare Name
  const docName = ocrData.fullName || [ocrData.firstName, ocrData.surname].filter(Boolean).join(' ');
  if (docName && staffRecord.name) {
    if (areNamesSimilar(docName, staffRecord.name)) {
      matches.push('Name');
    } else {
      mismatches.push({
        field: 'fullName',
        label: 'Name',
        documentValue: docName,
        recordValue: staffRecord.name,
        severity: 'warning',
        message: `Name mismatch: Document shows "${docName}", record has "${staffRecord.name}"`,
      });
    }
  }

  const totalFields = matches.length + mismatches.length;
  const criticalMismatches = mismatches.filter(m => m.severity === 'critical').length;
  const warningMismatches = mismatches.filter(m => m.severity === 'warning').length;

  let matchScore = 100;
  if (totalFields > 0) {
    matchScore = Math.max(0, Math.round(
      ((matches.length * 100) - (criticalMismatches * 50) - (warningMismatches * 20)) / totalFields
    ));
  }

  return {
    isValid: criticalMismatches === 0,
    matchScore,
    mismatches,
    matches,
    staffRecord: {
      name: staffRecord.name,
      saIdNumber: staffRecord.saIdNumber,
      position: staffRecord.position,
      department: staffRecord.department,
      startDate: null,
    },
  };
}

/**
 * Validate bank confirmation/statement against staff record
 * CRITICAL: Account holder name must match staff name to prevent uploading wrong person's document
 */
export async function validateBankDocument(
  staffId: string,
  ocrData: OcrDocumentData
): Promise<ValidationResult> {
  const mismatches: ValidationMismatch[] = [];
  const matches: string[] = [];

  const staffRecord = await fetchStaffRecord(staffId);

  if (!staffRecord) {
    return {
      isValid: true,
      matchScore: 100,
      mismatches: [],
      matches: [],
      staffRecord: null,
    };
  }

  // CRITICAL: Compare Account Holder Name against staff name
  // This is the primary check to prevent uploading wrong person's bank details
  const accountHolder = ocrData.accountHolder || ocrData.accountHolderName;
  if (accountHolder && staffRecord.name) {
    if (areNamesSimilar(accountHolder, staffRecord.name)) {
      matches.push('Account Holder Name');
    } else {
      mismatches.push({
        field: 'accountHolder',
        label: 'Account Holder',
        documentValue: accountHolder,
        recordValue: staffRecord.name,
        severity: 'critical',
        message: `⚠️ WRONG PERSON: Bank account belongs to "${accountHolder}" but staff record is for "${staffRecord.name}". This document appears to belong to someone else.`,
      });
    }
  } else if (!accountHolder) {
    // No account holder extracted - warn user to verify manually
    mismatches.push({
      field: 'accountHolder',
      label: 'Account Holder',
      documentValue: null,
      recordValue: staffRecord.name,
      severity: 'warning',
      message: `Account holder name could not be extracted. Please verify the document belongs to "${staffRecord.name}".`,
    });
  }

  // Bank name validation (info only - bank can change)
  const bankName = ocrData.bankName;
  if (bankName) {
    matches.push('Bank Name');
  }

  // Account number validation (format check)
  const accountNumber = ocrData.accountNumber;
  if (accountNumber) {
    const cleanAccount = accountNumber.replace(/[\s-]/g, '');
    if (/^\d{9,12}$/.test(cleanAccount)) {
      matches.push('Account Number (valid format)');
    } else {
      mismatches.push({
        field: 'accountNumber',
        label: 'Account Number',
        documentValue: accountNumber,
        recordValue: null,
        severity: 'warning',
        message: `Account number "${accountNumber}" may be invalid (expected 9-12 digits)`,
      });
    }
  }

  // Branch code validation (format check)
  const branchCode = ocrData.branchCode;
  if (branchCode) {
    const cleanBranch = branchCode.replace(/[\s-]/g, '');
    if (/^\d{6}$/.test(cleanBranch)) {
      matches.push('Branch Code (valid format)');
    } else {
      mismatches.push({
        field: 'branchCode',
        label: 'Branch Code',
        documentValue: branchCode,
        recordValue: null,
        severity: 'info',
        message: `Branch code "${branchCode}" may be invalid (expected 6 digits)`,
      });
    }
  }

  const totalFields = matches.length + mismatches.length;
  const criticalMismatches = mismatches.filter(m => m.severity === 'critical').length;
  const warningMismatches = mismatches.filter(m => m.severity === 'warning').length;

  let matchScore = 100;
  if (totalFields > 0) {
    matchScore = Math.max(0, Math.round(
      ((matches.length * 100) - (criticalMismatches * 50) - (warningMismatches * 20)) / totalFields
    ));
  }

  return {
    isValid: criticalMismatches === 0,
    matchScore,
    mismatches,
    matches,
    staffRecord: {
      name: staffRecord.name,
      saIdNumber: staffRecord.saIdNumber,
      position: staffRecord.position,
      department: staffRecord.department,
      startDate: null,
    },
  };
}

/**
 * Validate any document type against staff record
 */
export async function validateDocument(
  staffId: string,
  documentType: string,
  ocrData: OcrDocumentData
): Promise<ValidationResult> {
  switch (documentType) {
    case 'employment_contract':
      return validateEmploymentContract(staffId, ocrData);
    case 'sa_id':
    case 'id_document':
      return validateSaIdDocument(staffId, ocrData);
    case 'bank_details':
    case 'bank_statement':
    case 'bank_confirmation':
      return validateBankDocument(staffId, ocrData);
    default:
      // For other document types, return basic validation
      return {
        isValid: true,
        matchScore: 100,
        mismatches: [],
        matches: [],
        staffRecord: await fetchStaffRecord(staffId) as { name: string; saIdNumber: string | null; position: string | null; department: string | null; startDate: string | null; } | null,
      };
  }
}
