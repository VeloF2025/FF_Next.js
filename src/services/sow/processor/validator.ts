/**
 * SOW Data Validator - Backward Compatibility Layer
 * @deprecated Use ./validation/ modules for improved modular validation system
 * 
 * This file provides backward compatibility for existing imports.
 * New code should use the modular validation system in ./validation/
 */

// Re-export everything from the new modular structure
export * from './validation';

// Import classes for backward compatibility
import { SOWValidator } from './validation/sow-validator';
import { SOWErrorHandler } from './validation/error-handler';
import { ValidationResult } from './validation/validator-types';
import { NeonPoleData, NeonDropData, NeonFibreData } from '../neonSOWService';

/**
 * Validate poles data
 * @deprecated Use SOWValidator.validatePoles instead
 */
export function validatePoles(poles: NeonPoleData[]): ValidationResult<NeonPoleData> {
  return SOWValidator.validatePoles(poles);
}

/**
 * Validate drops data
 * @deprecated Use SOWValidator.validateDrops instead
 */
export function validateDrops(drops: NeonDropData[]): ValidationResult<NeonDropData> {
  return SOWValidator.validateDrops(drops);
}

/**
 * Validate fibre data
 * @deprecated Use SOWValidator.validateFibre instead
 */
export function validateFibre(fibres: NeonFibreData[]): ValidationResult<NeonFibreData> {
  return SOWValidator.validateFibre(fibres);
}

/**
 * Validate data based on type
 * @deprecated Use SOWValidator.validateData instead
 */
export function validateData(data: unknown[], type: 'poles' | 'drops' | 'fibre'): ValidationResult<unknown> {
  return SOWValidator.validateData(data as NeonPoleData[], type);
}

/**
 * Get validation summary
 * @deprecated Use SOWErrorHandler.getValidationSummary instead
 */
export function getValidationSummary(result: ValidationResult<unknown>): {
  totalCount: number;
  validCount: number;
  invalidCount: number;
  validationRate: number;
  errorSummary: { [key: string]: number };
} {
  const summary = SOWErrorHandler.getValidationSummary(result);
  return {
    totalCount: summary.totalRecords,
    validCount: summary.validRecords,
    invalidCount: summary.invalidRecords,
    validationRate: summary.validationRate,
    errorSummary: summary.errorsByCategory
  };
}

/**
 * Batch validate multiple datasets
 * @deprecated Use SOWErrorHandler.batchValidate instead
 */
export function batchValidate(datasets: { data: unknown[]; type: 'poles' | 'drops' | 'fibre' }[]): {
  results: ValidationResult<unknown>[];
  overallSummary: {
    totalDatasets: number;
    totalRecords: number;
    totalValidRecords: number;
    totalInvalidRecords: number;
    overallValidationRate: number;
  };
} {
  const batchResult = SOWErrorHandler.batchValidate(datasets);
  return {
    results: batchResult.results,
    overallSummary: {
      totalDatasets: batchResult.summary.totalDatasets,
      totalRecords: batchResult.summary.totalRecords,
      totalValidRecords: batchResult.summary.totalValid,
      totalInvalidRecords: batchResult.summary.totalInvalid,
      overallValidationRate: batchResult.summary.overallValidationRate
    }
  };
}

// Legacy helper functions removed - Use SOWValidationRules class instead

/**
 * Cross-validate data relationships
 * @deprecated Use SOWValidator.crossValidateData instead
 */
export function crossValidateData(poles: NeonPoleData[], drops: NeonDropData[]): {
  orphanedDrops: string[];
  missingPoles: string[];
  warnings: string[];
} {
  const result = SOWValidator.crossValidateData(poles, drops);
  return {
    orphanedDrops: result.orphanedDrops.map(drop => drop.drop_number),
    missingPoles: result.missingPoles,
    warnings: result.orphanedDrops.length > 0 ? 
      [`${result.orphanedDrops.length} drops reference non-existent poles`] : []
  };
}