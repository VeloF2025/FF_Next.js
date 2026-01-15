/**
 * Validation Service for Project Import
 * PRD-047: Pre-import validation with clear error messages
 */

import { log } from '@/lib/logger';
import {
  DataType,
  FieldMapping,
  ImportError,
  MappedField,
  ProcessedRow,
  ValidationResult,
} from './types';
import { findDbColumn, getMapping, getRequiredFields } from './mappings';

/**
 * Extract value from row with case-insensitive header matching
 */
export function extractValue(
  row: Record<string, unknown>,
  possibleKeys: string[]
): unknown {
  for (const key of possibleKeys) {
    // Try exact match
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }

    // Try case-insensitive match
    const foundKey = Object.keys(row).find(
      k => k.toLowerCase().trim() === key.toLowerCase().trim()
    );

    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && row[foundKey] !== '') {
      return row[foundKey];
    }
  }
  return undefined;
}

/**
 * Convert value to target type
 */
export function convertValue(
  value: unknown,
  field: FieldMapping
): { value: unknown; error: string | null } {
  if (value === undefined || value === null || value === '') {
    if (field.required) {
      return { value: null, error: `Required field is empty` };
    }
    return { value: null, error: null };
  }

  const stringValue = String(value).trim();

  switch (field.type) {
    case 'string':
      return { value: stringValue, error: null };

    case 'number': {
      // Handle measurements like "40m" or "1.5km"
      const cleaned = stringValue.replace(/[^\d.-]/g, '');
      const num = parseFloat(cleaned);
      if (isNaN(num)) {
        return { value: null, error: `Invalid number: "${stringValue}"` };
      }
      return { value: num, error: null };
    }

    case 'boolean': {
      const lower = stringValue.toLowerCase();
      if (['yes', 'true', '1', 'complete', 'completed', 'y'].includes(lower)) {
        return { value: true, error: null };
      }
      if (['no', 'false', '0', 'incomplete', 'pending', 'n', ''].includes(lower)) {
        return { value: false, error: null };
      }
      return { value: null, error: `Invalid boolean: "${stringValue}"` };
    }

    case 'date': {
      try {
        // Handle Excel serial dates
        if (typeof value === 'number') {
          const date = excelSerialToDate(value);
          return { value: date.toISOString(), error: null };
        }

        const date = new Date(stringValue);
        if (isNaN(date.getTime())) {
          return { value: null, error: `Invalid date: "${stringValue}"` };
        }
        return { value: date.toISOString(), error: null };
      } catch {
        return { value: null, error: `Failed to parse date: "${stringValue}"` };
      }
    }

    case 'json':
      return { value, error: null };

    default:
      return { value: stringValue, error: null };
  }
}

/**
 * Convert Excel serial date to JavaScript Date
 */
function excelSerialToDate(serial: number): Date {
  // Excel dates start from 1900-01-01 (serial 1)
  // But there's an Excel bug that treats 1900 as a leap year
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400 * 1000;
  return new Date(utcValue);
}

/**
 * Validate a single row and extract mapped data
 */
export function validateRow(
  row: Record<string, unknown>,
  dataType: DataType,
  rowNumber: number
): ProcessedRow {
  const mapping = getMapping(dataType);
  if (!mapping) {
    return {
      data: {},
      errors: [{ row: rowNumber, field: '', value: null, message: `Unknown data type: ${dataType}`, severity: 'error' }],
      rowNumber,
    };
  }

  const data: Record<string, unknown> = {};
  const errors: ImportError[] = [];

  for (const field of mapping.fields) {
    const rawValue = extractValue(row, field.excelHeaders);
    const { value, error } = convertValue(rawValue, field);

    if (error) {
      errors.push({
        row: rowNumber,
        field: field.dbColumn,
        value: rawValue,
        message: error,
        severity: field.required ? 'error' : 'warning',
      });
    }

    if (value !== null && value !== undefined) {
      // Apply transform if defined
      data[field.dbColumn] = field.transform ? field.transform(value) : value;
    }
  }

  // Store raw data for reference
  data.raw_data = row;

  return { data, errors, rowNumber };
}

/**
 * Validate entire dataset before import
 */
export function validateDataset(
  rows: Record<string, unknown>[],
  dataType: DataType,
  headers: string[]
): ValidationResult {
  const mapping = getMapping(dataType);
  if (!mapping) {
    return {
      valid: false,
      rowCount: rows.length,
      headers,
      mappings: [],
      issues: [{ row: 0, field: '', value: null, message: `Unknown data type: ${dataType}`, severity: 'error' }],
      preview: [],
    };
  }

  // Analyze header mappings
  const mappings: MappedField[] = headers.map(header => {
    const field = findDbColumn(mapping, header);
    const sampleRow = rows[0] || {};
    const sampleValue = sampleRow[header];

    return {
      excelHeader: header,
      dbColumn: field?.dbColumn || null,
      sampleValue,
      status: field ? 'mapped' : 'unmapped',
    };
  });

  // Check for required fields
  const requiredFields = getRequiredFields(dataType);
  const mappedHeaders = mappings
    .filter(m => m.status === 'mapped')
    .map(m => m.excelHeader.toLowerCase());

  const issues: ImportError[] = [];

  // Check if required fields are present
  for (const field of mapping.fields.filter(f => f.required)) {
    const hasRequired = field.excelHeaders.some(h =>
      mappedHeaders.includes(h.toLowerCase()) ||
      headers.some(header => header.toLowerCase() === h.toLowerCase())
    );

    if (!hasRequired) {
      issues.push({
        row: 0,
        field: field.dbColumn,
        value: null,
        message: `Required field missing: ${field.dbColumn} (expected headers: ${field.excelHeaders.join(', ')})`,
        severity: 'error',
      });
    }
  }

  // Validate first 10 rows for preview
  const preview: Record<string, unknown>[] = [];
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const result = validateRow(row, dataType, i + 1);
    preview.push(result.data);

    // Add critical errors from first rows
    for (const error of result.errors.filter(e => e.severity === 'error')) {
      if (issues.length < 20) {
        issues.push(error);
      }
    }
  }

  // Summary warnings
  const unmappedCount = mappings.filter(m => m.status === 'unmapped').length;
  if (unmappedCount > 0) {
    issues.push({
      row: 0,
      field: '',
      value: null,
      message: `${unmappedCount} Excel columns are not mapped to database fields`,
      severity: 'warning',
    });
  }

  const hasErrors = issues.some(i => i.severity === 'error');

  log.info(`Validated ${rows.length} rows for ${dataType}`, {
    data: {
      valid: !hasErrors,
      mappedFields: mappings.filter(m => m.status === 'mapped').length,
      unmappedFields: unmappedCount,
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
    },
  }, 'project-import');

  return {
    valid: !hasErrors,
    rowCount: rows.length,
    headers,
    mappings,
    issues,
    preview,
  };
}

/**
 * Check if a row has the primary identifier
 */
export function hasRequiredIdentifier(
  row: Record<string, unknown>,
  dataType: DataType
): boolean {
  const mapping = getMapping(dataType);
  if (!mapping) return false;

  const primaryField = mapping.fields.find(f => f.required);
  if (!primaryField) return true;

  const value = extractValue(row, primaryField.excelHeaders);
  return value !== undefined && value !== null && value !== '';
}
