/**
 * Validation Rules Engine
 * Core validation logic and rule definitions
 */

import { ImportError, ImportWarning, ValidationOptions } from './validation-types';

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number format (supports multiple formats)
 */
export function isValidPhone(phone: string): boolean {
  // Remove all non-numeric characters for validation
  const cleaned = phone.replace(/\D/g, '');
  // Accept phones between 10-15 digits
  return cleaned.length >= 10 && cleaned.length <= 15;
}

/**
 * Check if date is valid
 */
export function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Apply validation rules to a field
 */
export function applyValidationRules(
  value: unknown,
  fieldName: string,
  row: number,
  rules: ValidationOptions,
  errors: ImportError[],
  _warnings: ImportWarning[]
): boolean {
  let isValid = true;

  // Required validation
  if (rules.required && (value === null || value === undefined || value === '')) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} is required`
    });
    isValid = false;
  }

  // Skip other validations if value is empty and not required
  if (!rules.required && (value === null || value === undefined || value === '')) {
    return isValid;
  }

  const stringValue = String(value).trim();

  // Length validations
  if (rules.maxLength && stringValue.length > rules.maxLength) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} exceeds maximum length of ${rules.maxLength} characters`
    });
    isValid = false;
  }

  if (rules.minLength && stringValue.length < rules.minLength) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} must be at least ${rules.minLength} characters`
    });
    isValid = false;
  }

  // Pattern validation
  if (rules.pattern && !rules.pattern.test(stringValue)) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} format is invalid`
    });
    isValid = false;
  }

  // Custom validation
  if (rules.customValidator && !rules.customValidator(value)) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} failed custom validation`
    });
    isValid = false;
  }

  return isValid;
}

/**
 * Validate required field
 */
export function validateRequired(
  value: unknown,
  fieldName: string,
  row: number,
  errors: ImportError[]
): boolean {
  if (value === null || value === undefined || value === '') {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} is required`
    });
    return false;
  }
  return true;
}

/**
 * Validate string length constraints
 */
export function validateStringLength(
  value: string,
  fieldName: string,
  row: number,
  minLength?: number,
  maxLength?: number,
  errors: ImportError[] = []
): boolean {
  let isValid = true;

  if (maxLength && value.length > maxLength) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} exceeds maximum length of ${maxLength} characters`
    });
    isValid = false;
  }

  if (minLength && value.length < minLength) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} must be at least ${minLength} characters`
    });
    isValid = false;
  }

  return isValid;
}

/**
 * Validate numeric range
 */
export function validateNumericRange(
  value: number,
  fieldName: string,
  row: number,
  min?: number,
  max?: number,
  errors: ImportError[] = []
): boolean {
  let isValid = true;

  if (min !== undefined && value < min) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} must be at least ${min}`
    });
    isValid = false;
  }

  if (max !== undefined && value > max) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} cannot exceed ${max}`
    });
    isValid = false;
  }

  return isValid;
}

/**
 * Validate date range
 */
export function validateDateRange(
  date: Date,
  fieldName: string,
  row: number,
  minDate?: Date,
  maxDate?: Date,
  errors: ImportError[] = []
): boolean {
  let isValid = true;

  if (minDate && date < minDate) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} cannot be earlier than ${minDate.toDateString()}`
    });
    isValid = false;
  }

  if (maxDate && date > maxDate) {
    errors.push({
      type: 'validation',
      row,
      column: fieldName,
      message: `${fieldName} cannot be later than ${maxDate.toDateString()}`
    });
    isValid = false;
  }

  return isValid;
}