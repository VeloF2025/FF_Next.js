/**
 * SOW Validation Error Handler
 * Handles error processing, formatting, and summary generation
 */

import { ValidationResult, ValidationError, ValidationSummary, BatchValidationResult } from './validator-types';
import { SOWValidationRules } from './validation-rules';
import { SOWValidator } from './sow-validator';
import { NeonPoleData } from '../../neonSOWService';

/**
 * Error processing and formatting utilities
 */
export class SOWErrorHandler {
  /**
   * Get validation summary from result
   */
  static getValidationSummary(result: ValidationResult<unknown>): ValidationSummary {
    const totalRecords = result.valid.length + result.invalid.length;
    const validRecords = result.valid.length;
    const invalidRecords = result.invalid.length;
    const validationRate = totalRecords > 0 ? (validRecords / totalRecords) * 100 : 0;
    
    // Categorize errors
    const errorsByCategory: Record<string, number> = {};
    const allErrors: string[] = [];
    let criticalErrors = 0;
    let warnings = 0;
    
    result.errors.forEach(error => {
      const category = SOWValidationRules.categorizeError(error);
      errorsByCategory[category] = (errorsByCategory[category] || 0) + 1;
      allErrors.push(error);
      
      // Count severity levels (approximation from error text)
      if (error.toLowerCase().includes('missing') || 
          error.toLowerCase().includes('required') || 
          error.toLowerCase().includes('duplicate')) {
        criticalErrors++;
      } else if (error.toLowerCase().includes('warning') || 
                 error.toLowerCase().includes('suspicious') || 
                 error.toLowerCase().includes('unusual')) {
        warnings++;
      }
    });
    
    // Find most common errors
    const errorCounts: Record<string, number> = {};
    allErrors.forEach(error => {
      const key = error.split(':')[1]?.trim() || error;
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    });
    
    const mostCommonErrors = Object.entries(errorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([error]) => error);
    
    return {
      totalRecords,
      validRecords,
      invalidRecords,
      validationRate: Math.round(validationRate * 100) / 100,
      errorsByCategory,
      mostCommonErrors,
      criticalErrors,
      warnings
    };
  }

  /**
   * Batch validate multiple datasets
   */
  static batchValidate(datasets: { data: unknown[]; type: 'poles' | 'drops' | 'fibre' }[]): BatchValidationResult {
    const results = datasets.map(dataset => SOWValidator.validateData(dataset.data as NeonPoleData[], dataset.type));
    
    const totalDatasets = datasets.length;
    const totalRecords = results.reduce((sum, result) => sum + result.valid.length + result.invalid.length, 0);
    const totalValid = results.reduce((sum, result) => sum + result.valid.length, 0);
    const totalInvalid = results.reduce((sum, result) => sum + result.invalid.length, 0);
    const overallValidationRate = totalRecords > 0 ? 
      Math.round((totalValid / totalRecords) * 100 * 100) / 100 : 0;
    
    const datasetSummaries = datasets.map((dataset, index) => {
      const result = results[index]!;
      const total = result.valid.length + result.invalid.length;
      const validationRate = total > 0 ? (result.valid.length / total) * 100 : 0;

      return {
        type: dataset.type,
        validationRate: Math.round(validationRate * 100) / 100,
        errorCount: result.errors.length
      };
    });
    
    return {
      results,
      summary: {
        totalDatasets,
        totalRecords,
        totalValid,
        totalInvalid,
        overallValidationRate,
        datasetSummaries
      }
    };
  }

  /**
   * Format validation errors for display
   */
  static formatErrors(errors: ValidationError[]): {
    critical: ValidationError[];
    warnings: ValidationError[];
    info: ValidationError[];
    formatted: string[];
  } {
    const critical: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const info: ValidationError[] = [];
    const formatted: string[] = [];
    
    errors.forEach(error => {
      switch (error.severity) {
        case 'error':
          critical.push(error);
          break;
        case 'warning':
          warnings.push(error);
          break;
        case 'info':
          info.push(error);
          break;
      }
      
      const severityIcon = error.severity === 'error' ? '❌' : 
                          error.severity === 'warning' ? '⚠️' : 'ℹ️';
      formatted.push(`${severityIcon} ${error.field}: ${error.message} [${error.code}]`);
    });
    
    return { critical, warnings, info, formatted };
  }

  /**
   * Generate error report
   */
  static generateErrorReport(result: ValidationResult<unknown>, dataType: string): {
    title: string;
    summary: ValidationSummary;
    errorBreakdown: {
      critical: ValidationError[];
      warnings: ValidationError[];
      info: ValidationError[];
    };
    recommendations: string[];
  } {
    const summary = this.getValidationSummary(result);
    
    // Extract errors from invalid records
    const allErrors: ValidationError[] = [];
    result.invalid.forEach(record => {
      const rec = record as Record<string, unknown>;
      if (rec.errors && Array.isArray(rec.errors)) {
        allErrors.push(...(rec.errors as ValidationError[]));
      }
    });
    
    const { critical, warnings, info } = this.formatErrors(allErrors);
    
    // Generate recommendations based on common error patterns
    const recommendations: string[] = [];
    
    if (critical.length > 0) {
      recommendations.push(`Fix ${critical.length} critical errors before proceeding with data import`);
    }
    
    if (summary.errorsByCategory['Geographic']) {
      recommendations.push('Review coordinate data - consider using GPS validation tools');
    }
    
    if (summary.errorsByCategory['Required Fields']) {
      recommendations.push('Ensure all required fields are populated in source data');
    }
    
    if (summary.errorsByCategory['Duplicates']) {
      recommendations.push('Remove duplicate entries or implement unique constraint handling');
    }
    
    if (summary.errorsByCategory['Format/Type']) {
      recommendations.push('Standardize data formats and validate against expected schemas');
    }
    
    if (summary.validationRate < 80) {
      recommendations.push('Data quality is below 80% - consider data cleansing before import');
    }
    
    return {
      title: `${dataType.charAt(0).toUpperCase() + dataType.slice(1)} Validation Report`,
      summary,
      errorBreakdown: {
        critical,
        warnings,
        info
      },
      recommendations
    };
  }

  /**
   * Export validation results to different formats
   */
  static exportResults(result: ValidationResult<unknown>, format: 'json' | 'csv' | 'text' = 'json'): string {
    const summary = this.getValidationSummary(result);
    
    switch (format) {
      case 'json':
        return JSON.stringify({
          summary,
          validRecords: result.valid,
          invalidRecords: result.invalid,
          errors: result.errors
        }, null, 2);
        
      case 'csv': {
        const csvLines = ['Type,Field,Value,Message,Severity,Code'];
        result.invalid.forEach(record => {
          const rec = record as Record<string, unknown>;
          if (rec.errors && Array.isArray(rec.errors)) {
            rec.errors.forEach((error: ValidationError) => {
              const value = typeof error.value === 'object' ? 
                JSON.stringify(error.value).replace(/"/g, '""') : 
                String(error.value).replace(/"/g, '""');
              csvLines.push(
                `"Error","${error.field}","${value}","${error.message.replace(/"/g, '""')}","${error.severity}","${error.code}"`
              );
            });
          }
        });
        return csvLines.join('\n');
      }
        
      case 'text': {
        const lines = [
          '=== VALIDATION SUMMARY ===',
          `Total Records: ${summary.totalRecords}`,
          `Valid Records: ${summary.validRecords}`,
          `Invalid Records: ${summary.invalidRecords}`,
          `Validation Rate: ${summary.validationRate}%`,
          '',
          '=== ERROR BREAKDOWN ===',
          ...Object.entries(summary.errorsByCategory)
            .map(([category, count]) => `${category}: ${count}`),
          '',
          '=== MOST COMMON ERRORS ===',
          ...summary.mostCommonErrors.map((error, i) => `${i + 1}. ${error}`),
          '',
          '=== DETAILED ERRORS ===',
          ...result.errors.map(error => `• ${error}`)
        ];
        return lines.join('\n');
      }
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Check if validation result meets quality threshold
   */
  static meetsQualityThreshold(result: ValidationResult<unknown>, threshold: number = 90): {
    passes: boolean;
    currentRate: number;
    threshold: number;
    message: string;
  } {
    const summary = this.getValidationSummary(result);
    const passes = summary.validationRate >= threshold;
    
    return {
      passes,
      currentRate: summary.validationRate,
      threshold,
      message: passes 
        ? `Data quality meets threshold (${summary.validationRate}% >= ${threshold}%)`
        : `Data quality below threshold (${summary.validationRate}% < ${threshold}%)`
    };
  }
}