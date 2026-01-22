/**
 * Document Validation Service
 * Compares OCR-extracted data against staff records to detect mismatches
 * Used during document upload and verification to ensure documents belong to the correct person
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

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
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
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
        start_date as "startDate"
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
  ocrData: Record<string, any>
): Promise<ValidationResult> {
  const mismatches: ValidationMismatch[] = [];
  const matches: string[] = [];

  // Fetch current staff record
  const staffRecord = await fetchStaffRecord(staffId);

  if (!staffRecord) {
    return {
      isValid: false,
      matchScore: 0,
      mismatches: [{
        field: 'staffRecord',
        label: 'Staff Record',
        documentValue: null,
        recordValue: null,
        severity: 'critical',
        message: 'Staff record not found - cannot validate document',
      }],
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
        documentValue: ocrData.employeeIdNumber || ocrData.idNumber,
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
      documentValue: ocrData.employeeIdNumber || ocrData.idNumber,
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
        documentValue: ocrData.jobTitle || ocrData.position,
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
        documentValue: ocrData.department,
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
  ocrData: Record<string, any>
): Promise<ValidationResult> {
  const mismatches: ValidationMismatch[] = [];
  const matches: string[] = [];

  const staffRecord = await fetchStaffRecord(staffId);

  if (!staffRecord) {
    return {
      isValid: false,
      matchScore: 0,
      mismatches: [{
        field: 'staffRecord',
        label: 'Staff Record',
        documentValue: null,
        recordValue: null,
        severity: 'critical',
        message: 'Staff record not found',
      }],
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
        documentValue: ocrData.saIdNumber || ocrData.idNumber || ocrData.documentNumber,
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
 * Validate any document type against staff record
 */
export async function validateDocument(
  staffId: string,
  documentType: string,
  ocrData: Record<string, any>
): Promise<ValidationResult> {
  switch (documentType) {
    case 'employment_contract':
      return validateEmploymentContract(staffId, ocrData);
    case 'sa_id':
    case 'id_document':
      return validateSaIdDocument(staffId, ocrData);
    // Add more document types as needed
    default:
      // For other document types, return basic validation
      return {
        isValid: true,
        matchScore: 100,
        mismatches: [],
        matches: [],
        staffRecord: await fetchStaffRecord(staffId),
      };
  }
}
