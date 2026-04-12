/**
 * Data Parser Types and Interfaces
 * Common types used across parser modules
 */

export interface ImportError {
  type: 'validation' | 'parsing' | 'business';
  row: number;
  column: string;
  message: string;
  severity?: 'error' | 'warning';
}

export interface ImportWarning {
  type: 'validation' | 'parsing' | 'business';
  row: number;
  column: string;
  message: string;
  severity?: 'warning' | 'info';
}

export interface DataFormat {
  type: 'string' | 'number' | 'date' | 'boolean' | 'email' | 'phone';
  pattern?: RegExp;
  required?: boolean;
  constraints?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    allowEmpty?: boolean;
  };
}

export interface ParseResult<T = unknown> {
  value: T | undefined;
  success: boolean;
  errors: ImportError[];
  warnings: ImportWarning[];
  originalValue: unknown;
}

export interface SchemaField {
  name: string;
  format: DataFormat;
  aliases?: string[];
  defaultValue?: unknown;
  transformer?: (value: unknown) => unknown;
}

export interface DataSchema {
  fields: SchemaField[];
  strict?: boolean;
  allowExtraFields?: boolean;
}

export interface ValidationContext {
  row: number;
  field: string;
  schema: SchemaField | undefined;
  strict: boolean | undefined;
}

export type DataType = 'string' | 'number' | 'date' | 'boolean' | 'email' | 'phone' | 'unknown';

export interface FormatDetectionResult {
  type: DataType;
  confidence: number;
  samples: unknown[];
  pattern?: RegExp;
  commonFormats?: string[];
}