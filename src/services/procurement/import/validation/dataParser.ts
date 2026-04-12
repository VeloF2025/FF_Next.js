/**
 * Data Parser - Backward Compatibility Layer
 * @deprecated Use ./parser/index.ts for improved modular data parsing
 * 
 * This file provides backward compatibility for existing imports.
 * New code should use the modular parser system in ./parser/
 */

// Re-export everything from the new modular structure
export * from './parser';

// Import specific functions for backward compatibility
import { readString } from './parser/data-reader';
import type { ImportError, ImportWarning } from './parser/parser-types';
import { isEmailFormat, isPhoneFormat } from './parser/format-detector';

export { 
  parseNumber,
  parseBoolean,
  readString,
  readValue
} from './parser/data-reader';

export {
  parseDate
} from './modules/validation-helpers';

export {
  isNumberFormat,
  isDateFormat,
  isBooleanFormat,
  isEmailFormat,
  isPhoneFormat,
  detectDataType
} from './parser/format-detector';

export {
  validateAgainstSchema,
  validateField,
  generateSchemaFromData
} from './parser/schema-validator';

// Legacy functions for backward compatibility
export function validateString(
  value: unknown,
  row: number,
  field: string,
  errors: ImportError[],
  warnings: ImportWarning[],
  maxLength?: number,
  _required: boolean = false
): string | undefined {
  // Use the imported readString function
  const context = { row, field, schema: undefined, strict: undefined };
  const result = readString(value, context, errors, warnings);
  
  // Apply maxLength validation if specified
  if (result && maxLength && result.length > maxLength) {
    errors.push({
      type: 'validation',
      row,
      column: field,
      message: `String length exceeds maximum of ${maxLength} characters`
    });
    return result.substring(0, maxLength);
  }
  
  return result;
}

export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    .replace(/[<>]/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isValidEmail(email: string): boolean {
  return isEmailFormat(email);
}

export function isValidPhone(phone: string): boolean {
  return isPhoneFormat(phone);
}

export function normalizeString(str: string): string {
  if (!str || typeof str !== 'string') {
    return '';
  }
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}