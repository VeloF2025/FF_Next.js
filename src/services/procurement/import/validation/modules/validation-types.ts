/**
 * Validation Types and Interfaces
 * Common types used across validation modules
 */

export interface ImportError {
  type: 'validation' | 'mapping' | 'processing' | 'system' | 'parsing' | 'business';
  row: number;
  column?: string;
  message: string;
  severity?: 'error' | 'warning';
  details?: unknown;
}

export interface ImportWarning {
  type: 'mapping' | 'validation' | 'data' | 'parsing' | 'business';
  row: number;
  column?: string;
  message: string;
  severity?: 'warning' | 'info';
  details?: unknown;
}

export interface ValidationOptions {
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  customValidator?: (value: unknown) => boolean;
}

export interface ParseOptions {
  allowEmpty?: boolean;
  defaultValue?: unknown;
  transformValue?: (value: unknown) => unknown;
}

export interface ValidationResult<T = unknown> {
  value: T | undefined;
  isValid: boolean;
  errors: ImportError[];
  warnings: ImportWarning[];
}

export type ValidationType = 
  | 'string'
  | 'number' 
  | 'date'
  | 'boolean'
  | 'email'
  | 'phone'
  | 'text';

export type ValidationRule = {
  type: ValidationType;
  options?: ValidationOptions;
  parseOptions?: ParseOptions;
};