/**
 * Import Validation Module - Main Entry Point
 * Provides comprehensive validation for import data with schema and business rule validation
 */

import { z } from 'zod';
import { ImportError, ImportWarning, ParsedBOQItem, ValidationResult } from '../importTypes';
import { BOQItemValidationSchema, ExtendedBOQItemSchema } from './schema';
import { 
  validateDataConsistency, 
  validatePriceConsistency, 
  validateDataQuality, 
  validateProcurementRules,
  validateCrossItemDependencies
} from './business';
import { parseNumber, validateString } from './utils';

/**
 * Validate a single BOQ item with comprehensive checks
 * @param extractedData - The data to validate
 * @param rowNumber - Row number for error reporting
 * @param useExtendedValidation - Whether to use extended validation rules
 * @returns Validation result with errors and warnings
 */
export function validateBOQItem(
  extractedData: Partial<ParsedBOQItem>,
  rowNumber: number,
  useExtendedValidation: boolean = false
): ValidationResult {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];

  // Basic required field validation
  if (!extractedData.description?.trim()) {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'description',
      message: 'Description is required'
    });
  }

  if (!extractedData.quantity || isNaN(Number(extractedData.quantity))) {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'quantity',
      message: 'Valid quantity is required'
    });
  }

  if (!extractedData.uom?.trim()) {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'uom',
      message: 'Unit of measure is required'
    });
  }

  // Price consistency validation
  const priceWarnings = validatePriceConsistency(extractedData as ParsedBOQItem, rowNumber);
  warnings.push(...priceWarnings);

  // Data quality warnings
  const qualityWarnings = validateDataQuality(extractedData as ParsedBOQItem, rowNumber);
  warnings.push(...qualityWarnings);

  // Procurement-specific business rules
  const businessValidation = validateProcurementRules(extractedData as ParsedBOQItem, rowNumber);
  errors.push(...businessValidation.errors);
  warnings.push(...businessValidation.warnings);

  // Zod schema validation
  try {
    const schema = useExtendedValidation ? ExtendedBOQItemSchema : BOQItemValidationSchema;
    schema.parse(extractedData);
  } catch (zodError) {
    if (zodError instanceof z.ZodError) {
      zodError.errors.forEach(err => {
        errors.push({
          type: 'validation',
          row: rowNumber,
          column: err.path.join('.'),
          message: err.message,
          details: err
        });
      });
    }
  }

  const success = errors.length === 0;
  return {
    success,
    data: extractedData as ParsedBOQItem,
    errors,
    warnings
  };
}

/**
 * Validate multiple BOQ items with consistency checks
 * @param items - Array of BOQ items to validate
 * @param options - Validation options
 * @returns Combined validation results
 */
export function validateBOQItems(
  items: ParsedBOQItem[],
  options: {
    useExtendedValidation?: boolean;
    skipConsistencyChecks?: boolean;
    maxErrors?: number;
  } = {}
): {
  success: boolean;
  results: ValidationResult[];
  consistencyErrors: ImportError[];
  consistencyWarnings: ImportWarning[];
  crossItemWarnings: ImportWarning[];
} {
  const results: ValidationResult[] = [];
  const { useExtendedValidation = false, skipConsistencyChecks = false, maxErrors = 1000 } = options;
  
  let totalErrors = 0;

  // Validate individual items
  for (let i = 0; i < items.length; i++) {
    if (totalErrors >= maxErrors) {
      break;
    }

    const result = validateBOQItem(items[i]!, i + 1, useExtendedValidation);
    results.push(result);
    totalErrors += result.errors.length;
  }

  // Consistency validation across all items
  let consistencyErrors: ImportError[] = [];
  let consistencyWarnings: ImportWarning[] = [];
  let crossItemWarnings: ImportWarning[] = [];

  if (!skipConsistencyChecks && totalErrors < maxErrors) {
    const consistencyResult = validateDataConsistency(items);
    consistencyErrors = consistencyResult.errors;
    consistencyWarnings = consistencyResult.warnings;

    // Cross-item dependency validation
    crossItemWarnings = validateCrossItemDependencies(items);
  }

  const success = totalErrors === 0 && consistencyErrors.length === 0;

  return {
    success,
    results,
    consistencyErrors,
    consistencyWarnings,
    crossItemWarnings
  };
}

// Re-export all validation utilities and schemas
export * from './schema';
export * from './business';
export * from './utils';

// Re-export the original function names for backward compatibility
export { validateDataConsistency, parseNumber, validateString };