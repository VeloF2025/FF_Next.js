/**
 * Validation Helper Functions
 * Utility functions for parsing and converting data types
 */

import { ImportError, ImportWarning } from './validation-types';
import { isValidDate, isValidEmail, isValidPhone } from './validation-rules';

/**
 * Parse and validate a numeric value with comprehensive error handling
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
      } else {
        warnings.push({
          type: 'validation',
          row,
          column: field,
          message: `Could not parse "${value}" as number, using undefined`
        });
      }
      return undefined;
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

  // Handle boolean to number conversion
  if (typeof value === 'boolean') {
    warnings.push({
      type: 'validation',
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
 * Validate and clean string values
 */
export function validateString(
  value: unknown,
  row: number,
  field: string,
  errors: ImportError[],
  _warnings: ImportWarning[],
  maxLength?: number,
  required: boolean = false
): string | undefined {
  if (value === null || value === undefined) {
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

  const stringValue = String(value).trim();

  if (!stringValue && required) {
    errors.push({
      type: 'validation',
      row,
      column: field,
      message: `${field} cannot be empty`
    });
    return undefined;
  }

  if (maxLength && stringValue.length > maxLength) {
    errors.push({
      type: 'validation',
      row,
      column: field,
      message: `${field} exceeds maximum length of ${maxLength} characters`
    });
    return undefined;
  }

  return stringValue || undefined;
}

/**
 * Parse and validate date values
 */
export function parseDate(
  value: unknown,
  row: number,
  field: string,
  errors: ImportError[],
  warnings: ImportWarning[],
  required: boolean = false
): Date | undefined {
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

  // Handle Date objects
  if (value instanceof Date) {
    if (!isValidDate(value)) {
      errors.push({
        type: 'validation',
        row,
        column: field,
        message: `Invalid date: ${value}`
      });
      return undefined;
    }
    return value;
  }

  // Handle string dates
  if (typeof value === 'string') {
    // Try parsing ISO format first
    const isoDate = new Date(value);
    if (isValidDate(isoDate)) {
      return isoDate;
    }

    // Try common formats: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD
    const dateFormats = [
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // MM/DD/YYYY
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/, // MM-DD-YYYY
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/, // YYYY-MM-DD
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/ // DD.MM.YYYY
    ];

    for (const format of dateFormats) {
      const match = value.match(format);
      if (match) {
        let year, month, day;
        
        if (format.source.startsWith('^(\\d{4})')) {
          // YYYY-MM-DD format
          [, year, month, day] = match;
        } else {
          // MM/DD/YYYY or DD/MM/YYYY format - assume MM/DD/YYYY
          [, month, day, year] = match;
          // Add warning for potentially ambiguous date format
          warnings.push({
            type: 'validation',
            row,
            column: field,
            message: `Ambiguous date format "${value}" interpreted as MM/DD/YYYY. Consider using YYYY-MM-DD format for clarity.`
          });
        }

        const parsedDate = new Date(parseInt(year!), parseInt(month!) - 1, parseInt(day!));
        
        if (isValidDate(parsedDate)) {
          return parsedDate;
        }
      }
    }

    errors.push({
      type: 'validation',
      row,
      column: field,
      message: `Invalid date format: "${value}". Expected formats: MM/DD/YYYY, YYYY-MM-DD, or ISO date string`
    });
    return undefined;
  }

  // Handle numeric timestamps
  if (typeof value === 'number') {
    const date = new Date(value);
    if (isValidDate(date)) {
      return date;
    }
    
    errors.push({
      type: 'validation',
      row,
      column: field,
      message: `Invalid timestamp: ${value}`
    });
    return undefined;
  }

  errors.push({
    type: 'validation',
    row,
    column: field,
    message: `Cannot parse ${typeof value} as date: "${value}"`
  });
  return undefined;
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
    
    if (['true', 'yes', '1', 'on', 'active', 'enabled'].includes(lowercased)) {
      return true;
    }
    
    if (['false', 'no', '0', 'off', 'inactive', 'disabled'].includes(lowercased)) {
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
 * Sanitize text by removing harmful characters
 */
export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/[\r\n\t]/g, ' ') // Replace line breaks and tabs with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Normalize string for consistent comparison
 */
export function normalizeString(str: string): string {
  if (!str || typeof str !== 'string') {
    return '';
  }

  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Parse email with validation
 */
export function parseEmail(
  value: unknown,
  row: number,
  field: string,
  errors: ImportError[],
  warnings: ImportWarning[],
  required: boolean = false
): string | undefined {
  const stringValue = validateString(value, row, field, errors, warnings, 255, required);
  
  if (!stringValue) {
    return undefined;
  }

  if (!isValidEmail(stringValue)) {
    errors.push({
      type: 'validation',
      row,
      column: field,
      message: `Invalid email format: "${stringValue}"`
    });
    return undefined;
  }

  return stringValue.toLowerCase();
}

/**
 * Parse phone number with validation
 */
export function parsePhone(
  value: unknown,
  row: number,
  field: string,
  errors: ImportError[],
  warnings: ImportWarning[],
  required: boolean = false
): string | undefined {
  const stringValue = validateString(value, row, field, errors, warnings, 20, required);
  
  if (!stringValue) {
    return undefined;
  }

  if (!isValidPhone(stringValue)) {
    errors.push({
      type: 'validation',
      row,
      column: field,
      message: `Invalid phone number format: "${stringValue}"`
    });
    return undefined;
  }

  return stringValue;
}