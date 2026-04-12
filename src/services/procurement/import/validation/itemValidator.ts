/**
 * Item Validator
 * Validates individual BOQ items
 */

import { z } from 'zod';
import { BOQItemValidationSchema } from './schemas';
import type { ImportError, ImportWarning, ParsedBOQItem, ValidationResult } from '../importTypes';

/**
 * Validate a single BOQ item
 */
export function validateBOQItem(
  extractedData: Partial<ParsedBOQItem>,
  rowNumber: number
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
  if (extractedData.unitPrice && extractedData.totalPrice && extractedData.quantity) {
    const calculatedTotal = extractedData.unitPrice * extractedData.quantity;
    const actualTotal = extractedData.totalPrice;
    const tolerance = calculatedTotal * 0.01; // 1% tolerance

    if (Math.abs(calculatedTotal - actualTotal) > tolerance) {
      warnings.push({
        type: 'validation',
        row: rowNumber,
        column: 'totalPrice',
        message: `Total price (${actualTotal}) doesn't match unit price × quantity (${calculatedTotal.toFixed(2)})`,
        suggestion: `Consider updating total price to ${calculatedTotal.toFixed(2)}`
      });
    }
  }

  // Data quality warnings
  if (extractedData.description && extractedData.description.length < 5) {
    warnings.push({
      type: 'data',
      row: rowNumber,
      column: 'description',
      message: 'Description seems too short',
      suggestion: 'Consider providing more detailed description'
    });
  }

  if (extractedData.quantity && extractedData.quantity > 10000) {
    warnings.push({
      type: 'data',
      row: rowNumber,
      column: 'quantity',
      message: 'Unusually large quantity detected',
      suggestion: 'Please verify this quantity is correct'
    });
  }

  // Zod schema validation
  try {
    BOQItemValidationSchema.parse(extractedData);
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
 * Validate price calculations for BOQ item
 */
export function validatePriceCalculation(
  item: Partial<ParsedBOQItem>,
  rowNumber: number,
  tolerance: number = 0.01
): { isValid: boolean; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  
  if (!item.unitPrice || !item.totalPrice || !item.quantity) {
    return { isValid: true, warnings }; // Skip if values are missing
  }
  
  const calculatedTotal = item.unitPrice * item.quantity;
  const actualTotal = item.totalPrice;
  const toleranceAmount = calculatedTotal * tolerance;
  
  const isValid = Math.abs(calculatedTotal - actualTotal) <= toleranceAmount;
  
  if (!isValid) {
    warnings.push({
      type: 'validation',
      row: rowNumber,
      column: 'totalPrice',
      message: `Total price (${actualTotal}) doesn't match unit price × quantity (${calculatedTotal.toFixed(2)})`,
      suggestion: `Consider updating total price to ${calculatedTotal.toFixed(2)}`
    });
  }
  
  return { isValid, warnings };
}

/**
 * Validate quantity values
 */
export function validateQuantity(
  quantity: unknown,
  rowNumber: number,
  minValue: number = 0,
  maxValue: number = 1000000
): { isValid: boolean; errors: ImportError[]; warnings: ImportWarning[] } {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  
  if (quantity === null || quantity === undefined || quantity === '') {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'quantity',
      message: 'Quantity is required'
    });
    return { isValid: false, errors, warnings };
  }
  
  const numericQuantity = Number(quantity);
  
  if (isNaN(numericQuantity)) {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'quantity',
      message: `Invalid quantity value: "${quantity}"`
    });
    return { isValid: false, errors, warnings };
  }
  
  if (numericQuantity < minValue) {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'quantity',
      message: `Quantity must be at least ${minValue}`
    });
    return { isValid: false, errors, warnings };
  }
  
  if (numericQuantity > maxValue) {
    warnings.push({
      type: 'data',
      row: rowNumber,
      column: 'quantity',
      message: `Unusually large quantity: ${numericQuantity}`,
      suggestion: 'Please verify this quantity is correct'
    });
  }
  
  return { isValid: true, errors, warnings };
}

/**
 * Validate description field
 */
export function validateDescription(
  description: unknown,
  rowNumber: number,
  minLength: number = 1,
  maxLength: number = 500
): { isValid: boolean; errors: ImportError[]; warnings: ImportWarning[] } {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  
  if (!description || typeof description !== 'string' || !description.trim()) {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'description',
      message: 'Description is required'
    });
    return { isValid: false, errors, warnings };
  }
  
  const trimmedDescription = description.trim();
  
  if (trimmedDescription.length < minLength) {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'description',
      message: `Description must be at least ${minLength} character(s)`
    });
    return { isValid: false, errors, warnings };
  }
  
  if (trimmedDescription.length > maxLength) {
    errors.push({
      type: 'validation',
      row: rowNumber,
      column: 'description',
      message: `Description exceeds maximum length of ${maxLength} characters`
    });
    return { isValid: false, errors, warnings };
  }
  
  if (trimmedDescription.length < 5) {
    warnings.push({
      type: 'data',
      row: rowNumber,
      column: 'description',
      message: 'Description seems too short',
      suggestion: 'Consider providing more detailed description'
    });
  }
  
  return { isValid: true, errors, warnings };
}
