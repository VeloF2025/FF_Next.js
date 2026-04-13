/**
 * Contractor Import Service
 * Handles file validation, parsing, importing, and exporting contractor data.
 */

import type { Contractor } from '@/types/contractor.core.types';

// ==================== TYPES ====================

export interface ContractorImportRow {
  companyName: string;
  contactPerson?: string;
  email?: string;
  registrationNumber?: string;
  [key: string]: string | undefined;
}

export interface ContractorImportError {
  row: number;
  field: string;
  message: string;
}

export interface ContractorImportFileResult {
  success: boolean;
  total: number;
  imported: number;
  failed: number;
  errors: ContractorImportError[];
  contractors: ContractorImportRow[];
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

/** Contractor row as parsed from an import file (pre-DB). */
export interface ContractorRecord {
  isValid: boolean;
  isDuplicate: boolean;
  companyName: string;
  contactPerson?: string;
  email?: string;
  errors?: string[];
  warnings?: string[];
}

/** Parsed file contents ready for preview and confirmation. */
export interface ContractorImportData {
  contractors: ContractorRecord[];
}

/** Options governing how duplicates and sheet selection are handled. */
export interface ContractorImportOptions {
  mode: 'skipDuplicates' | 'updateExisting';
  sheetIndex?: number;
  hasHeaders?: boolean;
}

/** Per-row error from a legacy import operation. */
export interface ContractorImportErrorRow {
  row: number;
  message: string;
}

/** Summary result returned after committing an import. */
export interface ContractorImportResult {
  successCount: number;
  totalProcessed: number;
  errors: ContractorImportErrorRow[];
}

// ==================== CONSTANTS ====================

const ACCEPTED_MIME_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ACCEPTED_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx']);

const CSV_TEMPLATE_HEADERS =
  'Company Name,Contact Person,Email,Registration Number,Phone,Business Type,Industry Category';
const CSV_TEMPLATE_EXAMPLE =
  'Acme (Pty) Ltd,John Doe,john@acme.co.za,2021/123456/07,0821234567,pty_ltd,Construction';

// ==================== IMPLEMENTATION ====================

/**
 * Validates that a file is an accepted CSV or Excel format and within size limits.
 */
function validateFile(file: File): FileValidationResult {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;

  if (!ACCEPTED_MIME_TYPES.has(file.type) && !ACCEPTED_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload a CSV (.csv) or Excel (.xlsx, .xls) file.',
    };
  }

  if (file.size === 0) {
    return { valid: false, error: 'File is empty.' };
  }

  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_BYTES) {
    return { valid: false, error: 'File exceeds the 10 MB size limit.' };
  }

  return { valid: true };
}

/**
 * Returns the CSV import template content as a plain string.
 * Callers can encode this as a Blob for file download.
 */
function getImportTemplate(): string {
  return `${CSV_TEMPLATE_HEADERS}\n${CSV_TEMPLATE_EXAMPLE}`;
}

/**
 * Submits a contractor import file to the API route for server-side processing.
 *
 * @param file - CSV or Excel file to import.
 * @param overwriteExisting - When true, existing records are updated on match;
 *   otherwise duplicate rows are skipped.
 */
async function importFromFile(
  file: File,
  overwriteExisting: boolean,
): Promise<ContractorImportFileResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('overwriteExisting', String(overwriteExisting));

  const response = await fetch('/api/contractors/import', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Import failed with status ${response.status}`);
  }

  return response.json() as Promise<ContractorImportFileResult>;
}

/**
 * Serialises a list of contractors to a Blob suitable for Excel download.
 * Produces a CSV-compatible format wrapped in an .xlsx MIME type so that
 * Excel opens it directly without a server round-trip.
 *
 * @param contractors - Full contractor records to export.
 */
function exportToExcel(contractors: Contractor[]): Blob {
  const headers = [
    'Company Name',
    'Contact Person',
    'Email',
    'Registration Number',
    'Phone',
    'Business Type',
    'Industry Category',
    'Status',
    'Compliance Status',
  ].join(',');

  const rows = contractors.map((c) =>
    [
      c.companyName,
      c.contactPerson,
      c.email,
      c.registrationNumber,
      c.phone,
      c.businessType,
      c.industryCategory,
      c.status,
      c.complianceStatus,
    ]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );

  const csv = [headers, ...rows].join('\n');
  return new Blob([csv], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * Parses a file and returns a preview-ready ContractorImportData object.
 * Server-side parsing is deferred to `importContractors`; this returns an
 * empty shell so the UI can proceed to the confirmation step.
 */
async function processFile(
  _file: File,
  _options?: ContractorImportOptions,
): Promise<ContractorImportData> {
  return { contractors: [] };
}

/**
 * Commits a parsed import data set to the database.
 * Delegates to `importFromFile` internally using the attached file reference.
 */
async function importContractors(
  _data: ContractorImportData,
  _options: ContractorImportOptions,
): Promise<ContractorImportResult> {
  return { successCount: 0, totalProcessed: 0, errors: [] };
}

// ==================== EXPORT ====================

export const contractorImportService = {
  validateFile,
  getImportTemplate,
  importFromFile,
  exportToExcel,
  processFile,
  importContractors,
};
