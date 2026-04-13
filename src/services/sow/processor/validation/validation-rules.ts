/**
 * SOW Validation Rules - Legacy Compatibility Layer
 * @deprecated This file has been split into modular components for better maintainability.
 * 
 * NEW STRUCTURE:
 * - rules/basic-validators.ts - Basic validation functions (pole type, status, date format)
 * - rules/coordinate-validators.ts - Geographic coordinate validation
 * - rules/field-validators.ts - Specific field validation functions
 * - rules/error-utils.ts - Error categorization and severity functions
 * - rules/quality-validators.ts - Data quality validation
 * 
 * Please use the new modular imports:
 * import { BasicValidators, CoordinateValidators, FieldValidators, ErrorUtils, QualityValidators } from './rules';
 * 
 * This file will be removed in a future version. Use the modular structure instead.
 */

// Import from new modular structure for backward compatibility
import {
  BasicValidators,
  CoordinateValidators,
  FieldValidators,
  ErrorUtils,
  QualityValidators,
  ValidationError
} from './rules';

/**
 * Legacy SOWValidationRules class for backward compatibility
 * @deprecated Use individual validator classes from './rules' instead
 */
export class SOWValidationRules {
  // Basic validation methods - delegate to BasicValidators
  static isValidPoleType(type: string): boolean {
    return BasicValidators.isValidPoleType(type);
  }

  static isValidPoleStatus(status: string): boolean {
    return BasicValidators.isValidPoleStatus(status);
  }

  static isValidDateFormat(dateString: string): boolean {
    return BasicValidators.isValidDateFormat(dateString);
  }

  static validateStatus(status: string, validStatuses: string[]): ValidationError | null {
    return BasicValidators.validateStatus(status, validStatuses);
  }

  // Coordinate validation methods - delegate to CoordinateValidators
  static validateCoordinates(latitude?: number, longitude?: number): ValidationError[] {
    return CoordinateValidators.validateCoordinates(latitude, longitude);
  }

  // Field validation methods - delegate to FieldValidators
  static validatePoleNumber(poleNumber: string): ValidationError | null {
    return FieldValidators.validatePoleNumber(poleNumber);
  }

  static validateDropId(dropId: string): ValidationError | null {
    return FieldValidators.validateDropId(dropId);
  }

  static validateFibreLength(length?: number): ValidationError | null {
    return FieldValidators.validateFibreLength(length);
  }

  static validateFibreType(type?: string): ValidationError | null {
    return FieldValidators.validateFibreType(type);
  }

  static validateServiceType(serviceType?: string): ValidationError | null {
    return FieldValidators.validateServiceType(serviceType);
  }

  static validateHeight(height?: number): ValidationError | null {
    return FieldValidators.validateHeight(height);
  }

  static validateAddress(address?: string): ValidationError | null {
    return FieldValidators.validateAddress(address);
  }

  static validateInstallationDate(dateString?: string): ValidationError | null {
    return FieldValidators.validateInstallationDate(dateString);
  }

  // Error utility methods - delegate to ErrorUtils
  static categorizeError(error: string): string {
    return ErrorUtils.categorizeError(error);
  }

  static getErrorSeverity(errorCode: string): 'error' | 'warning' | 'info' {
    return ErrorUtils.getErrorSeverity(errorCode);
  }

  // Quality validation methods - delegate to QualityValidators
  static checkDataQuality(record: Record<string, unknown>): ValidationError[] {
    return QualityValidators.checkDataQuality(record);
  }
}