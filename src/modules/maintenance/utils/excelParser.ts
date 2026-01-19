/**
 * Excel Parser Utility
 * 🟢 WORKING: Production-ready Excel file parser for weekly ticket imports
 *
 * Provides functions for:
 * - Parsing Excel files and extracting ticket data
 * - Mapping Excel columns to ticket fields
 * - Validating required fields
 * - Detecting duplicate entries
 * - Generating import previews
 * - Performance-optimized for 100+ rows (<5s)
 *
 * Features:
 * - Configurable column mapping
 * - Custom validation and transform functions
 * - Duplicate detection
 * - Comprehensive error handling
 * - Whitespace trimming
 * - Empty row skipping
 */

import * as XLSX from 'xlsx';
import {
  ImportRow,
  ExcelColumnMapping,
  ImportPreviewResult,
  ImportValidationError,
  ImportErrorType
} from '../types/weeklyReport';

/**
 * Excel parse options
 */
export interface ExcelParseOptions {
  hasHeaders?: boolean; // Default: true
  columnMapping?: ExcelColumnMapping[];
  sheetName?: string; // If not provided, uses first sheet
  skipEmptyRows?: boolean; // Default: true
  trimWhitespace?: boolean; // Default: true
}

/**
 * Excel parse result
 */
export interface ExcelParseResult {
  success: boolean;
  rows: ImportRow[];
  total_rows: number;
  skipped_rows: number;
  errors: string[];
  headers?: string[];
}

/**
 * Validation result for a single row
 */
export interface ValidationResult {
  is_valid: boolean;
  errors: ImportValidationError[];
}

/**
 * Duplicate detection result
 */
export interface DuplicateResult {
  row_number: number;
  duplicate_field: string;
  duplicate_value: any;
}

/**
 * Preview generation options
 */
export interface PreviewOptions {
  sampleSize?: number; // Default: 10
  checkDuplicates?: boolean; // Default: true
  duplicateField?: string; // Default: 'ticket_uid'
}

/**
 * Parse an Excel file buffer and extract rows
 *
 * @param buffer - Excel file buffer
 * @param options - Parse options
 * @returns Parse result with rows and errors
 */
export async function parseExcelFile(
  buffer: Buffer,
  options: ExcelParseOptions = {}
): Promise<ExcelParseResult> {
  const {
    hasHeaders = true,
    columnMapping,
    sheetName,
    skipEmptyRows = true,
    trimWhitespace = true
  } = options;

  const result: ExcelParseResult = {
    success: false,
    rows: [],
    total_rows: 0,
    skipped_rows: 0,
    errors: []
  };

  try {
    // Parse Excel file
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Check if workbook has any sheets
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      result.errors.push('Excel file is empty');
      return result;
    }

    // Get sheet (use provided name or first sheet)
    const sheet = sheetName
      ? workbook.Sheets[sheetName]
      : workbook.Sheets[workbook.SheetNames[0]];

    if (!sheet) {
      result.errors.push('Excel file is empty');
      return result;
    }

    // Check if sheet has any data
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const hasAnyRows = range.e.r >= range.s.r; // End row >= start row means at least one row

    // Convert sheet to JSON
    const rawData: any[] = XLSX.utils.sheet_to_json(sheet, {
      header: hasHeaders ? undefined : 'A', // Use column letters if no headers
      defval: '', // Default value for empty cells
      raw: false // Return formatted strings
    });

    if (rawData.length === 0) {
      // If sheet has no rows at all, it's empty
      // If sheet has rows but rawData is empty, it means headers exist but no data
      if (!hasAnyRows || !sheet['!ref']) {
        result.errors.push('Excel file is empty');
      } else {
        result.errors.push('Excel file contains no data rows');
      }
      return result;
    }

    // Extract headers if present
    if (hasHeaders) {
      result.headers = Object.keys(rawData[0]);
    }

    // Create column mapping if not provided
    const mapping =
      columnMapping || (hasHeaders ? createDefaultColumnMapping(result.headers!) : []);

    // Process rows
    let rowIndex = hasHeaders ? 2 : 1; // Start from row 2 if headers exist

    for (const rawRow of rawData) {
      // Check if row is empty
      if (skipEmptyRows && isEmptyRow(rawRow)) {
        result.skipped_rows++;
        rowIndex++;
        continue;
      }

      // Map row to ticket fields
      const importRow = mapRowToTicket(rawRow, mapping, rowIndex);

      // Trim whitespace if enabled
      if (trimWhitespace) {
        trimRowValues(importRow);
      }

      result.rows.push(importRow);
      rowIndex++;
    }

    result.total_rows = result.rows.length;
    result.success = true;
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : 'Failed to parse Excel file'
    );
  }

  return result;
}

/**
 * Validate a single row against column mapping
 *
 * @param row - Import row to validate
 * @param columnMapping - Column mapping with validation rules
 * @returns Validation result with errors
 */
export function validateRow(
  row: ImportRow,
  columnMapping: ExcelColumnMapping[]
): ValidationResult {
  const result: ValidationResult = {
    is_valid: true,
    errors: []
  };

  for (const mapping of columnMapping) {
    const fieldValue = row[mapping.ticket_field as keyof ImportRow];

    // Check required fields
    if (mapping.required) {
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        result.is_valid = false;
        result.errors.push({
          row_number: row.row_number,
          severity: 'error',
          field_name: mapping.ticket_field,
          message: `Field '${mapping.ticket_field}' is required but missing or empty`
        });
        continue;
      }
    }

    // Run custom validation if provided
    if (mapping.validate && fieldValue !== undefined && fieldValue !== null) {
      const isValid = mapping.validate(fieldValue);
      if (!isValid) {
        result.is_valid = false;
        result.errors.push({
          row_number: row.row_number,
          severity: 'error',
          field_name: mapping.ticket_field,
          message: `Validation failed for field '${mapping.ticket_field}'`
        });
      }
    }
  }

  return result;
}

/**
 * Detect duplicate entries in rows
 *
 * @param rows - Import rows to check
 * @param field - Field to check for duplicates
 * @returns Array of duplicate results
 */
export function detectDuplicates(
  rows: ImportRow[],
  field: keyof ImportRow
): DuplicateResult[] {
  const duplicates: DuplicateResult[] = [];
  const valueMap = new Map<any, number[]>();

  // Build map of values to row numbers
  for (const row of rows) {
    const value = row[field];

    // Skip undefined/null values
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const rowNumbers = valueMap.get(value) || [];
    rowNumbers.push(row.row_number);
    valueMap.set(value, rowNumbers);
  }

  // Find duplicates (values that appear more than once)
  for (const [value, rowNumbers] of valueMap.entries()) {
    if (rowNumbers.length > 1) {
      for (const rowNumber of rowNumbers) {
        duplicates.push({
          row_number: rowNumber,
          duplicate_field: field as string,
          duplicate_value: value
        });
      }
    }
  }

  return duplicates;
}

/**
 * Generate import preview with validation errors
 *
 * @param rows - Import rows to preview
 * @param columnMapping - Column mapping for validation
 * @param options - Preview options
 * @returns Import preview result
 */
export function generatePreview(
  rows: ImportRow[],
  columnMapping: ExcelColumnMapping[],
  options: PreviewOptions = {}
): ImportPreviewResult {
  const { sampleSize = 10, checkDuplicates = true, duplicateField = 'ticket_uid' } = options;

  const preview: ImportPreviewResult = {
    total_rows: rows.length,
    valid_rows: 0,
    invalid_rows: 0,
    sample_rows: [],
    validation_errors: [],
    column_mapping: columnMapping,
    can_proceed: false
  };

  // Validate all rows
  for (const row of rows) {
    const validationResult = validateRow(row, columnMapping);

    if (validationResult.is_valid) {
      preview.valid_rows++;
    } else {
      preview.invalid_rows++;
      preview.validation_errors.push(...validationResult.errors);
    }
  }

  // Check for duplicates if enabled
  if (checkDuplicates) {
    const duplicates = detectDuplicates(rows, duplicateField as keyof ImportRow);

    for (const duplicate of duplicates) {
      preview.validation_errors.push({
        row_number: duplicate.row_number,
        severity: 'warning',
        field_name: duplicate.duplicate_field,
        message: `Found duplicate ${duplicate.duplicate_field}: ${duplicate.duplicate_value}`
      });
    }
  }

  // Get sample rows
  preview.sample_rows = rows.slice(0, sampleSize);

  // Determine if import can proceed
  preview.can_proceed = preview.valid_rows > 0;

  return preview;
}

/**
 * Create default column mapping from Excel headers
 *
 * @param headers - Excel column headers
 * @returns Default column mapping
 */
export function createDefaultColumnMapping(headers: string[]): ExcelColumnMapping[] {
  const mapping: ExcelColumnMapping[] = [];

  // Common field mappings (case-insensitive)
  // Supports both standard ticketing format AND maintenance Excel format
  const fieldMappings: Record<string, { field: string; required: boolean }> = {
    // Ticket UID mappings
    'ticket id': { field: 'ticket_uid', required: false },
    'ticket_uid': { field: 'ticket_uid', required: false },
    'ft ref': { field: 'ft_ref', required: false },        // Maintenance Excel: FT Ref
    'ft_ref': { field: 'ft_ref', required: false },
    'ftref': { field: 'ft_ref', required: false },
    'reference': { field: 'ft_ref', required: false },
    // Title/Issue mappings
    title: { field: 'title', required: false },            // Changed from required: true
    issue: { field: 'issue', required: false },            // Maintenance Excel: Issue → title
    description: { field: 'description', required: false },
    // Type mappings (not required for maintenance imports)
    type: { field: 'ticket_type', required: false },       // Changed from required: true
    'ticket type': { field: 'ticket_type', required: false },
    'ticket_type': { field: 'ticket_type', required: false },
    // Area/Project mapping
    area: { field: 'area', required: false },              // Maintenance Excel: Area → project
    priority: { field: 'priority', required: false },
    status: { field: 'status', required: false },
    'dr number': { field: 'dr_number', required: false },
    'dr_number': { field: 'dr_number', required: false },
    dr: { field: 'dr_number', required: false },
    'pole number': { field: 'pole_number', required: false },
    'pole_number': { field: 'pole_number', required: false },
    pole: { field: 'pole_number', required: false },
    'pon number': { field: 'pon_number', required: false },
    'pon_number': { field: 'pon_number', required: false },
    pon: { field: 'pon_number', required: false },
    zone: { field: 'zone', required: false },
    address: { field: 'address', required: false },
    'assigned to': { field: 'assigned_to', required: false },
    'assigned_to': { field: 'assigned_to', required: false },
    contractor: { field: 'contractor_name', required: false },
    'contractor name': { field: 'contractor_name', required: false },
    'contractor_name': { field: 'contractor_name', required: false },
    'fault description': { field: 'fault_description', required: false },
    'fault_description': { field: 'fault_description', required: false },
    'fault cause': { field: 'fault_cause', required: false },
    'fault_cause': { field: 'fault_cause', required: false },
    'created date': { field: 'created_date', required: false },
    'created_date': { field: 'created_date', required: false },
    date: { field: 'created_date', required: false }
  };

  for (const header of headers) {
    const normalizedHeader = header.toLowerCase().trim();
    const fieldMapping = fieldMappings[normalizedHeader];

    if (fieldMapping) {
      mapping.push({
        excel_column: header,
        ticket_field: fieldMapping.field,
        required: fieldMapping.required
      });
    } else {
      // Unknown column - add as non-required with original name
      mapping.push({
        excel_column: header,
        ticket_field: header.toLowerCase().replace(/\s+/g, '_'),
        required: false
      });
    }
  }

  return mapping;
}

/**
 * Map Excel row to ImportRow using column mapping
 *
 * @param excelRow - Raw Excel row data
 * @param columnMapping - Column mapping
 * @param rowNumber - Row number in Excel file
 * @returns Mapped import row
 */
export function mapRowToTicket(
  excelRow: any,
  columnMapping: ExcelColumnMapping[],
  rowNumber: number
): ImportRow {
  const importRow: ImportRow = {
    row_number: rowNumber,
    title: '',
    ticket_type: ''
  };

  for (const mapping of columnMapping) {
    let value = excelRow[mapping.excel_column];

    // Apply transform function if provided
    if (value !== undefined && value !== null && mapping.transform) {
      value = mapping.transform(value);
    }

    // Assign to import row
    (importRow as any)[mapping.ticket_field] = value;
  }

  return importRow;
}

/**
 * Check if a row is empty (all values are empty strings, null, or undefined)
 *
 * @param row - Row to check
 * @returns True if row is empty
 */
function isEmptyRow(row: any): boolean {
  const values = Object.values(row);
  return values.every(value => value === '' || value === null || value === undefined);
}

/**
 * Trim whitespace from all string values in a row
 *
 * @param row - Row to trim
 */
function trimRowValues(row: ImportRow): void {
  for (const key of Object.keys(row) as (keyof ImportRow)[]) {
    const value = row[key];
    if (typeof value === 'string') {
      (row as any)[key] = value.trim();
    }
  }
}
