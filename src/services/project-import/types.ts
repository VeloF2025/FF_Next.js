/**
 * Project Import Service Types
 * PRD-047: Unified import system for drops, poles, and fibre data
 */

export type DataType = 'drops' | 'poles' | 'fibre';

export interface FieldMapping {
  excelHeaders: string[];  // Possible Excel column names (case-insensitive)
  dbColumn: string;        // Target database column
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  required: boolean;
  transform?: (value: unknown) => unknown;
}

export interface DataTypeMapping {
  dataType: DataType;
  tableName: string;
  primaryKey: string;
  uniqueConstraint: string[];
  fields: FieldMapping[];
}

export interface ImportOptions {
  clearExisting?: boolean;   // Default: false - use upsert instead
  validateOnly?: boolean;    // Default: false - just validate, don't import
  batchSize?: number;        // Default: 500
  skipInvalid?: boolean;     // Default: false - skip rows with errors
}

export interface ImportError {
  row: number;
  field: string;
  value: unknown;
  message: string;
  severity: 'error' | 'warning';
}

export interface ImportStats {
  totalRows: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface ValidationResult {
  valid: boolean;
  rowCount: number;
  headers: string[];
  mappings: MappedField[];
  issues: ImportError[];
  preview: Record<string, unknown>[];
}

export interface MappedField {
  excelHeader: string;
  dbColumn: string | null;
  sampleValue: unknown;
  status: 'mapped' | 'unmapped' | 'ignored';
}

export interface ImportResult {
  success: boolean;
  dataType: DataType;
  projectId: string;
  stats: ImportStats;
  errors: ImportError[];
  duration: number;
}

export interface ProcessedRow {
  data: Record<string, unknown>;
  errors: ImportError[];
  rowNumber: number;
}

// Re-export SOW types for convenience
export type { NeonPoleData, NeonDropData, NeonFibreData } from '../sow/types';
