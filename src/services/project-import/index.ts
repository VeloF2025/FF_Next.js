/**
 * Project Import Service
 * PRD-047: Unified import system for drops, poles, and fibre data
 *
 * Usage:
 * ```typescript
 * import {
 *   importData,
 *   validateImport,
 *   parseExcelFile,
 *   detectDataType
 * } from '@/services/project-import';
 *
 * // Validate before import
 * const validation = await validateImport(fileData, 'drops');
 * if (validation.valid) {
 *   const result = await importData(fileData, projectId, 'drops');
 * }
 * ```
 */

// Types
export type {
  DataType,
  FieldMapping,
  ImportError,
  ImportOptions,
  ImportResult,
  ImportStats,
  MappedField,
  ProcessedRow,
  ValidationResult,
} from './types';

// Mappings
export {
  DROPS_MAPPING,
  FIBRE_MAPPING,
  findDbColumn,
  getAllMappings,
  getMapping,
  getRequiredFields,
  POLES_MAPPING,
} from './mappings';

// Validators
export {
  convertValue,
  extractValue,
  hasRequiredIdentifier,
  validateDataset,
  validateRow,
} from './validators';

// Import Service
export {
  detectDataType,
  getProjectImportStatus,
  importData,
  importMultiple,
  parseExcelFile,
  validateImport,
} from './importService';
