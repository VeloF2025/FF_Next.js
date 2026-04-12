/**
 * Quality Validators
 * Data quality validation functions for detecting common issues
 */

import { ValidationError } from '../validator-types';

interface QualityRecord {
  latitude?: number | string;
  longitude?: number | string;
  installation_date?: string;
  planning_date?: string;
  status?: string;
  [key: string]: unknown;
}

export class QualityValidators {
  /**
   * Check for common data quality issues
   */
  static checkDataQuality(record: QualityRecord): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check for suspiciously similar coordinates (handled by CoordinateValidators)
    if (record.latitude && record.longitude) {
      const lat = record.latitude.toString();
      const lon = record.longitude.toString();
      
      if (lat === lon) {
        errors.push({
          field: 'coordinates',
          value: { latitude: record.latitude, longitude: record.longitude },
          message: 'Latitude and longitude are identical - possible data entry error',
          severity: 'warning',
          code: 'SUSPICIOUS_COORDINATES'
        });
      }
    }

    // Check for placeholder values
    errors.push(...this.checkPlaceholderValues(record));

    return errors;
  }

  /**
   * Check for placeholder values in record fields
   */
  static checkPlaceholderValues(record: QualityRecord): ValidationError[] {
    const errors: ValidationError[] = [];
    const placeholderValues = ['test', 'placeholder', 'tbd', 'n/a', 'unknown', ''];
    
    Object.entries(record).forEach(([field, value]) => {
      if (typeof value === 'string' && placeholderValues.includes(value.toLowerCase())) {
        errors.push({
          field,
          value,
          message: `Field contains placeholder value: "${value}"`,
          severity: 'info',
          code: 'PLACEHOLDER_VALUE'
        });
      }
    });

    return errors;
  }

  /**
   * Check for missing critical fields
   */
  static checkMissingCriticalFields(record: QualityRecord, criticalFields: string[]): ValidationError[] {
    const errors: ValidationError[] = [];
    
    criticalFields.forEach(field => {
      const fieldValue = record[field];
      if (!fieldValue || (typeof fieldValue === 'string' && fieldValue.trim() === '')) {
        errors.push({
          field,
          value: fieldValue,
          message: `Critical field "${field}" is missing or empty`,
          severity: 'error',
          code: 'MISSING_CRITICAL_FIELD'
        });
      }
    });

    return errors;
  }

  /**
   * Check for data consistency issues
   */
  static checkDataConsistency(record: QualityRecord): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check if installation date is before planning date
    if (record.installation_date && record.planning_date) {
      const installDate = new Date(record.installation_date);
      const planDate = new Date(record.planning_date);
      
      if (installDate < planDate) {
        errors.push({
          field: 'installation_date',
          value: record.installation_date,
          message: 'Installation date cannot be before planning date',
          severity: 'error',
          code: 'INCONSISTENT_DATES'
        });
      }
    }

    // Check if status and dates are consistent
    if (record.status === 'installed' && !record.installation_date) {
      errors.push({
        field: 'installation_date',
        value: record.installation_date,
        message: 'Installation date is required when status is "installed"',
        severity: 'warning',
        code: 'MISSING_INSTALLATION_DATE'
      });
    }

    return errors;
  }
}
