/**
 * Error Formatting Utilities
 * Functions for formatting and displaying validation errors and warnings
 */

import { ImportError, ImportWarning, ValidationResult } from './validation-types';

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ImportError[]): string[] {
  return errors.map(error => formatSingleError(error));
}

/**
 * Format validation warnings for display
 */
export function formatValidationWarnings(warnings: ImportWarning[]): string[] {
  return warnings.map(warning => formatSingleWarning(warning));
}

/**
 * Format a single error message
 */
export function formatSingleError(error: ImportError): string {
  const prefix = `Row ${error.row}:`;
  const column = error.column ? ` [${error.column}]` : '';
  const type = error.type ? ` (${error.type})` : '';
  return `${prefix}${column}${type} ${error.message}`;
}

/**
 * Format a single warning message
 */
export function formatSingleWarning(warning: ImportWarning): string {
  const prefix = `Row ${warning.row}:`;
  const column = warning.column ? ` [${warning.column}]` : '';
  const type = warning.type ? ` (${warning.type})` : '';
  return `${prefix}${column}${type} ${warning.message}`;
}

/**
 * Group errors by type
 */
export function groupErrorsByType(errors: ImportError[]): Record<string, ImportError[]> {
  return errors.reduce((groups, error) => {
    const type = error.type || 'unknown';
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(error);
    return groups;
  }, {} as Record<string, ImportError[]>);
}

/**
 * Group errors by column
 */
export function groupErrorsByColumn(errors: ImportError[]): Record<string, ImportError[]> {
  return errors.reduce((groups, error) => {
    const column = error.column || 'unknown';
    if (!groups[column]) {
      groups[column] = [];
    }
    groups[column].push(error);
    return groups;
  }, {} as Record<string, ImportError[]>);
}

/**
 * Get error summary statistics
 */
export function getErrorSummary(errors: ImportError[], warnings: ImportWarning[]) {
  const errorsByType = groupErrorsByType(errors);
  const errorsByColumn = groupErrorsByColumn(errors);
  
  const warningsByType = warnings.reduce((groups, warning) => {
    const type = warning.type || 'unknown';
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(warning);
    return groups;
  }, {} as Record<string, ImportWarning[]>);

  return {
    totalErrors: errors.length,
    totalWarnings: warnings.length,
    errorsByType,
    errorsByColumn,
    warningsByType,
    hasValidationErrors: errors.some(e => e.type === 'validation'),
    hasParsingErrors: errors.some(e => e.type === 'parsing'),
    hasBusinessErrors: errors.some(e => e.type === 'business'),
    mostCommonError: Object.keys(errorsByType).length > 0 
      ? Object.keys(errorsByType).reduce((a, b) =>
          (errorsByType[a] as any[]).length > (errorsByType[b] as any[]).length ? a : b
        )
      : null,
    problematicColumns: Object.keys(errorsByColumn).filter(col => (errorsByColumn[col] as any[]).length > 1)
  };
}

/**
 * Create validation result object
 */
export function createValidationResult<T = any>(
  value?: T,
  errors: ImportError[] = [],
  warnings: ImportWarning[] = []
): ValidationResult<T> {
  return {
    value,
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Format validation result summary
 */
export function formatValidationSummary(results: ValidationResult[]): string {
  const totalValidations = results.length;
  const successfulValidations = results.filter(r => r.isValid).length;
  const failedValidations = totalValidations - successfulValidations;
  
  const allErrors = results.flatMap(r => r.errors);
  const allWarnings = results.flatMap(r => r.warnings);
  
  const summary = getErrorSummary(allErrors, allWarnings);
  
  let output = `Validation Summary:\n`;
  output += `- Total Validations: ${totalValidations}\n`;
  output += `- Successful: ${successfulValidations}\n`;
  output += `- Failed: ${failedValidations}\n`;
  output += `- Errors: ${summary.totalErrors}\n`;
  output += `- Warnings: ${summary.totalWarnings}\n`;
  
  if (summary.mostCommonError) {
    output += `- Most Common Error: ${summary.mostCommonError} (${(summary.errorsByType[summary.mostCommonError] as any[]).length} occurrences)\n`;
  }
  
  if (summary.problematicColumns.length > 0) {
    output += `- Problematic Columns: ${summary.problematicColumns.join(', ')}\n`;
  }
  
  return output;
}

/**
 * Convert errors to CSV format for export
 */
export function errorsToCSV(errors: ImportError[]): string {
  const headers = ['Row', 'Column', 'Type', 'Message', 'Severity'];
  const rows = errors.map(error => [
    error.row.toString(),
    error.column || '',
    error.type || '',
    `"${error.message.replace(/"/g, '""')}"`, // Escape quotes in CSV
    error.severity || 'error'
  ]);
  
  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

/**
 * Convert warnings to CSV format for export
 */
export function warningsToCSV(warnings: ImportWarning[]): string {
  const headers = ['Row', 'Column', 'Type', 'Message', 'Severity'];
  const rows = warnings.map(warning => [
    warning.row.toString(),
    warning.column || '',
    warning.type || '',
    `"${warning.message.replace(/"/g, '""')}"`, // Escape quotes in CSV
    warning.severity || 'warning'
  ]);
  
  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

/**
 * Create detailed error report
 */
export function createErrorReport(
  errors: ImportError[], 
  warnings: ImportWarning[],
  context?: { filename?: string; timestamp?: Date; totalRows?: number }
): string {
  let report = `Validation Error Report\n`;
  report += `========================\n\n`;
  
  if (context) {
    if (context.filename) report += `File: ${context.filename}\n`;
    if (context.timestamp) report += `Generated: ${context.timestamp.toISOString()}\n`;
    if (context.totalRows) report += `Total Rows Processed: ${context.totalRows}\n`;
    report += `\n`;
  }
  
  report += formatValidationSummary([createValidationResult(undefined, errors, warnings)]);
  report += `\n`;
  
  if (errors.length > 0) {
    report += `ERRORS:\n`;
    report += `--------\n`;
    formatValidationErrors(errors).forEach(error => {
      report += `${error}\n`;
    });
    report += `\n`;
  }
  
  if (warnings.length > 0) {
    report += `WARNINGS:\n`;
    report += `----------\n`;
    formatValidationWarnings(warnings).forEach(warning => {
      report += `${warning}\n`;
    });
    report += `\n`;
  }
  
  return report;
}