/**
 * SOW Data Validator
 * Handles validation of SOW data against business rules
 */

import {
  SOWValidationResult,
  SOWValidationRules,
  SOWInputData,
  DEFAULT_VALIDATION_RULES
} from './types';

export class SOWDataValidator {
  private rules: SOWValidationRules;

  constructor(rules: SOWValidationRules = DEFAULT_VALIDATION_RULES) {
    this.rules = rules;
  }

  /**
   * Validate SOW data
   */
  validate(data: SOWInputData): SOWValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate pole count
    this.validatePoleCount(data.poleCount, errors, warnings);

    // Validate drop count
    this.validateDropCount(
      data.dropCount, 
      data.poleCount, 
      errors, 
      warnings
    );

    // Validate cable length
    this.validateCableLength(data.cableLength, errors, warnings);

    // Validate estimated cost
    this.validateEstimatedCost(data.estimatedCost, warnings);

    // Additional validations
    this.validateDataCompleteness(data, errors);
    this.validateDataConsistency(data, warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate pole count
   */
  private validatePoleCount(
    poleCount: number | undefined,
    errors: string[],
    warnings: string[]
  ): void {
    if (!poleCount || poleCount < this.rules.minPoleCount) {
      errors.push(`Pole count must be at least ${this.rules.minPoleCount}`);
    }

    if (poleCount && poleCount > this.rules.maxPoleCount) {
      warnings.push('Pole count exceeds typical project size');
    }
  }

  /**
   * Validate drop count
   */
  private validateDropCount(
    dropCount: number | undefined,
    poleCount: number | undefined,
    errors: string[],
    warnings: string[]
  ): void {
    if (!dropCount || dropCount < this.rules.minDropCount) {
      errors.push(`Drop count must be at least ${this.rules.minDropCount}`);
    }

    if (dropCount && poleCount) {
      const maxDrops = poleCount * this.rules.maxDropsPerPole;
      if (dropCount > maxDrops) {
        errors.push(
          `Drop count exceeds maximum (${this.rules.maxDropsPerPole} per pole)`
        );
      }

      // Warning for unusual drop-to-pole ratio
      const dropRatio = dropCount / poleCount;
      if (dropRatio < 2) {
        warnings.push('Low drop-to-pole ratio detected');
      } else if (dropRatio > 10) {
        warnings.push('High drop-to-pole ratio detected');
      }
    }
  }

  /**
   * Validate cable length
   */
  private validateCableLength(
    cableLength: number | undefined,
    errors: string[],
    warnings: string[]
  ): void {
    if (cableLength && cableLength < 0) {
      errors.push('Cable length cannot be negative');
    }

    if (cableLength && cableLength > 100000) {
      warnings.push('Cable length exceeds typical values');
    }
  }

  /**
   * Validate estimated cost
   */
  private validateEstimatedCost(
    estimatedCost: number | undefined,
    warnings: string[]
  ): void {
    if (estimatedCost && estimatedCost > 10000000) {
      warnings.push('Estimated cost exceeds typical project budget');
    }
  }

  /**
   * Validate data completeness
   */
  private validateDataCompleteness(
    data: SOWInputData,
    errors: string[]
  ): void {
    const requiredFields = ['poleCount', 'dropCount'];
    
    requiredFields.forEach(field => {
      if (!data[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    });
  }

  /**
   * Validate data consistency
   */
  private validateDataConsistency(
    data: SOWInputData,
    warnings: string[]
  ): void {
    // Check for logical inconsistencies
    if (data.poleCount && data.cableLength) {
      const avgCablePerPole = data.cableLength / data.poleCount;
      if (avgCablePerPole < 50) {
        warnings.push('Cable length seems low for pole count');
      } else if (avgCablePerPole > 5000) {
        warnings.push('Cable length seems high for pole count');
      }
    }
  }

  /**
   * Update validation rules
   */
  updateRules(rules: Partial<SOWValidationRules>): void {
    this.rules = { ...this.rules, ...rules };
  }
}