/**
 * Stock Error Formatter - Modular Barrel Export
 * Provides backward compatibility and unified access to formatter modules
 */

// Export all types
export * from './formatter-types';

// Export formatters
export { CoreErrorFormatter } from './error-formatter';
export { DisplayFormatter } from './display-formatter';
export { LogFormatter } from './log-formatter';

// Re-export main formatter class for backward compatibility
import { StockError } from '../inventory';
import { CoreErrorFormatter } from './error-formatter';
import { DisplayFormatter } from './display-formatter';
import { LogFormatter } from './log-formatter';
import { 
  UserErrorDisplay, 
  SystemErrorLog, 
  ApiErrorResponse, 
  MultipleErrorsResult, 
  ErrorReport 
} from './formatter-types';

/**
 * Unified Stock Error Formatter
 * Maintains backward compatibility with the original formatter interface
 * @deprecated Use individual formatter classes (CoreErrorFormatter, DisplayFormatter, LogFormatter) for better modularity
 */
export class StockErrorFormatter {
  /**
   * Format stock error for user display
   */
  static formatErrorForUser(error: StockError): UserErrorDisplay {
    return CoreErrorFormatter.formatErrorForUser(error);
  }

  /**
   * Format error for system logging
   */
  static formatErrorForLogging(error: StockError, context?: Record<string, unknown>): SystemErrorLog {
    return LogFormatter.formatErrorForLogging(error, context);
  }

  /**
   * Format error for API response
   */
  static formatErrorForApi(error: StockError): ApiErrorResponse {
    return CoreErrorFormatter.formatErrorForApi(error);
  }

  /**
   * Format multiple errors for bulk display
   */
  static formatMultipleErrors(errors: StockError[]): MultipleErrorsResult {
    return DisplayFormatter.formatMultipleErrors(errors);
  }

  /**
   * Generate error report
   */
  static generateErrorReport(errors: StockError[], timeRange: { start: Date; end: Date }): ErrorReport {
    return DisplayFormatter.generateErrorReport(errors, timeRange);
  }
}