/**
 * SOW Validation Types - Validation and import-related types
 */

import { ValidationLevel } from './enums.types';

export enum ValidationCriticality {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export interface ValidationResult {
  field: string;
  level: ValidationLevel;
  message: string;
  code?: string;
  value?: unknown;
}

export interface ValidationResults {
  isValid: boolean;
  errors: ValidationResult[];
  warnings: ValidationResult[];
  infos: ValidationResult[];
  totalIssues: number;
}

export interface ImportSummary {
  totalRows: number;
  processedRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  skippedRows: number;
  processingTime: number; // milliseconds
  fileName: string;
  fileSize: number; // bytes
  importDate: Date;
}

// Missing validation interfaces
export interface ImportValidation {
  isValid: boolean;
  errors: ValidationResult[];
  warnings: ValidationResult[];
  summary: ImportSummary;
  data?: Record<string, unknown>[];
}

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string;
  required: boolean;
  dataType: 'string' | 'number' | 'date' | 'boolean';
  transform?: (value: unknown) => unknown;
  validate?: (value: unknown) => ValidationResult | null;
}

export interface DataQualityReport {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  incompleteRecords: number;
  qualityScore: number; // 0-100
  issues: ValidationResult[];
  recommendations: string[];
}

export interface ValidationRule {
  field: string;
  rule: 'required' | 'format' | 'range' | 'custom';
  parameters?: Record<string, unknown>;
  message: string;
  severity: ValidationCriticality;
  validator?: (value: unknown) => boolean;
}