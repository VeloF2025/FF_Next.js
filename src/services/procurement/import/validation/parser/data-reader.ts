/**
 * Data Reader Module
 * Core functions for reading and parsing different data types
 */

import { ImportError, ImportWarning, ParseResult, ValidationContext } from './parser-types';
import { parseDate } from '../modules/validation-helpers';

/**
 * Parse and validate a numeric value
 */
export function parseNumber(
  value: unknown,
  row: number,
  field: string,
  errors: ImportError[],
  warnings: ImportWarning[],
  required: boolean = false
): number | undefined {
  if (value === null || value === undefined || value === '') {
    if (required) {
      errors.push({
        type: 'validation',
        row,
        column: field,
        message: `${field} is required`
      });
    }
    return undefined;
  }

  // Handle string numbers
  if (typeof value === 'string') {
    // Remove common non-numeric characters
    const cleaned = value.replace(/[$,\s]/g, '');
    const parsed = parseFloat(cleaned);

    if (isNaN(parsed)) {
      if (required) {
        errors.push({
          type: 'validation',
          row,
          column: field,
          message: `Invalid number format: "${value}"`
        });
      }
      return undefined;
    }

    // Warn about formatting issues
    if (value !== cleaned) {
      warnings.push({
        type: 'parsing',
        row,
        column: field,
        message: `Cleaned number format from "${value}" to "${cleaned}"`
      });
    }

    return parsed;
  }

  // Handle numeric values
  if (typeof value === 'number') {
    if (isNaN(value)) {
      errors.push({
        type: 'validation',
        row,
        column: field,
        message: `${field} contains NaN value`
      });
      return undefined;
    }
    return value;
  }

  // Handle boolean conversion
  if (typeof value === 'boolean') {
    warnings.push({
      type: 'parsing',
      row,
      column: field,
      message: `Converting boolean ${value} to number ${value ? 1 : 0}`
    });
    return value ? 1 : 0;
  }

  errors.push({
    type: 'validation',
    row,
    column: field,
    message: `Cannot convert ${typeof value} to number: "${value}"`
  });
  return undefined;
}

/**
 * Read and validate string values
 */
export function readString(
  value: unknown,
  _context: ValidationContext,
  _errors: ImportError[],
  _warnings: ImportWarning[]
): string | undefined {

  if (value === null || value === undefined) {
    return undefined;
  }

  const stringValue = String(value).trim();
  return stringValue || undefined;
}


/**
 * Parse and validate boolean values
 */
export function parseBoolean(
  value: unknown,
  row: number,
  field: string,
  errors: ImportError[],
  warnings: ImportWarning[],
  required: boolean = false
): boolean | undefined {
  if (value === null || value === undefined || value === '') {
    if (required) {
      errors.push({
        type: 'validation',
        row,
        column: field,
        message: `${field} is required`
      });
    }
    return undefined;
  }

  // Handle boolean values
  if (typeof value === 'boolean') {
    return value;
  }

  // Handle string boolean values
  if (typeof value === 'string') {
    const lowercased = value.toLowerCase().trim();
    
    const trueValues = ['true', 'yes', '1', 'on', 'active', 'enabled'];
    const falseValues = ['false', 'no', '0', 'off', 'inactive', 'disabled'];
    
    if (trueValues.includes(lowercased)) {
      return true;
    }
    
    if (falseValues.includes(lowercased)) {
      return false;
    }

    warnings.push({
      type: 'validation',
      row,
      column: field,
      message: `Ambiguous boolean value "${value}", interpreting as false`
    });
    return false;
  }

  // Handle numeric boolean values
  if (typeof value === 'number') {
    return value !== 0;
  }

  warnings.push({
    type: 'validation',
    row,
    column: field,
    message: `Cannot parse ${typeof value} as boolean: "${value}", using false`
  });
  return false;
}

/**
 * Read value with type conversion
 */
export function readValue<T = unknown>(
  value: unknown,
  targetType: string,
  context: ValidationContext,
  errors: ImportError[],
  warnings: ImportWarning[]
): T | undefined {
  const { row, field } = context;

  switch (targetType) {
    case 'string':
      return readString(value, context, errors, warnings) as T;
    case 'number':
      return parseNumber(value, row, field, errors, warnings) as T;
    case 'date':
      return parseDate(value, row, field, errors, warnings) as T;
    case 'boolean':
      return parseBoolean(value, row, field, errors, warnings) as T;
    default:
      warnings.push({
        type: 'parsing',
        row,
        column: field,
        message: `Unknown target type: ${targetType}, returning as string`
      });
      return readString(value, context, errors, warnings) as T;
  }
}

/**
 * Create parse result object
 */
export function createParseResult<T = unknown>(
  value: T | undefined,
  originalValue: unknown,
  errors: ImportError[] = [],
  warnings: ImportWarning[] = []
): ParseResult<T> {
  return {
    value,
    success: errors.length === 0,
    errors,
    warnings,
    originalValue
  };
}