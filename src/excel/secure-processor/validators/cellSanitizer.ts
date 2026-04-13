/**
 * Cell Content Sanitization
 */

import { log } from '@/lib/logger';
import { MAX_CELL_LENGTH } from '../constants/excelConstants';
import { containsDangerousPattern, stripHTML } from './securityValidators';

/**
 * Sanitize cell value with security checks
 */
export function sanitizeCellValue(
  value: unknown,
  maxLength: number = MAX_CELL_LENGTH,
  allowHTML: boolean = false
): string {
  if (value == null || value === undefined) return '';

  let stringValue = String(value).trim();

  // Length validation
  if (stringValue.length > maxLength) {
    log.warn(`Cell content truncated: ${stringValue.length} > ${maxLength} chars`, undefined, 'secure-excel');
    stringValue = stringValue.substring(0, maxLength);
  }

  // Security pattern detection
  const dangerCheck = containsDangerousPattern(stringValue);
  if (dangerCheck.isDangerous) {
    log.warn(`Dangerous pattern blocked: ${dangerCheck.pattern?.source}`,
      { value: stringValue.substring(0, 100) }, 'secure-excel');
    throw new Error(`Content contains potentially dangerous pattern: ${dangerCheck.pattern?.source}`);
  }

  // HTML removal if not allowed
  if (!allowHTML && /<[^>]*>/.test(stringValue)) {
    stringValue = stripHTML(stringValue);
    log.info('HTML content removed from cell', undefined, 'secure-excel');
  }

  return stringValue;
}
