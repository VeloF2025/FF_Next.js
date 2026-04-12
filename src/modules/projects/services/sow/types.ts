/**
 * SOW Service Types
 * Type definitions for SOW service operations
 */

export interface SOWMetadata {
  poleCount?: number;
  dropCount?: number;
  cableLength?: number;
  estimatedCost?: number;
}

export interface SOWUploadFile {
  file: File;
  type: string;
  metadata?: SOWMetadata;
}

export interface SOWDataExtractionResult {
  poleCount?: number;
  dropCount?: number;
  cableLength?: number;
  estimatedCost?: number;
  rawData?: any[];
}

export interface SOWValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SOWInputData {
  poleCount?: number;
  dropCount?: number;
  cableLength?: number;
  estimatedCost?: number;
  [key: string]: unknown;
}

export interface SOWValidationRules {
  minPoleCount: number;
  maxPoleCount: number;
  minDropCount: number;
  maxDropsPerPole: number;
}

export const DEFAULT_VALIDATION_RULES: SOWValidationRules = {
  minPoleCount: 1,
  maxPoleCount: 1000,
  minDropCount: 1,
  maxDropsPerPole: 12,
};

export const SOW_CONFIG = {
  STORAGE_PATH: 'projects/sow-documents',
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  ALLOWED_TYPES: [
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
  ],
} as const;