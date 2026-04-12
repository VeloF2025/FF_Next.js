/**
 * Error Handlers - Legacy Compatibility Layer
 * @deprecated Use './handlers' modular components instead
 * This file maintains backward compatibility for existing imports
 * New code should import from './handlers' directly
 */

// Re-export everything from the modular structure
export * from './handlers';

// Import services for legacy function compatibility
import {
  ProcurementErrorFactory,
  ProcurementErrorProcessor,
  ProcurementErrorLogger,
  ProcurementErrorAggregator,
  ProcurementRetryService,
  ErrorResponse,
  ErrorLogContext,
  BatchErrorItem
} from './handlers';
import { ProcurementErrorCodes } from './error.constants';

// Legacy function implementations using new modular services
const errorProcessor = new ProcurementErrorProcessor();
const errorLogger = new ProcurementErrorLogger();
const errorAggregator = new ProcurementErrorAggregator();
const retryService = new ProcurementRetryService();

/**
 * Create a standard procurement error with proper error code mapping
 * @deprecated Use ProcurementErrorFactory.createProcurementError() instead
 */
export function createProcurementError(
  code: keyof typeof ProcurementErrorCodes,
  message?: string,
  context?: Record<string, unknown>
) {
  return ProcurementErrorFactory.createProcurementError(code, message, context);
}

/**
 * Create a validation error for form/input validation
 * @deprecated Use ProcurementErrorFactory.createValidationError() instead
 */
export function createValidationError(
  field: string,
  message: string,
  value?: unknown
) {
  return ProcurementErrorFactory.createValidationError(field, message, value);
}

/**
 * Create a not found error with resource information
 * @deprecated Use ProcurementErrorFactory.createNotFoundError() instead
 */
export function createNotFoundError(
  resourceType: string,
  resourceId: string,
  context?: Record<string, unknown>
) {
  return ProcurementErrorFactory.createNotFoundError(resourceType, resourceId, context);
}

/**
 * Main error handler middleware for API responses
 * @deprecated Use ProcurementErrorProcessor.handleError() instead
 */
export function handleProcurementError(error: unknown): ErrorResponse {
  return errorProcessor.handleError(error);
}

/**
 * Enhanced error handler with context and user-friendly messages
 * @deprecated Use ProcurementErrorProcessor.handleErrorWithContext() instead
 */
export function handleProcurementErrorWithContext(
  error: unknown,
  context: ErrorLogContext
): ErrorResponse {
  return errorProcessor.handleErrorWithContext(error, context);
}

/**
 * Log error with context for debugging and monitoring
 * @deprecated Use ProcurementErrorLogger.log() instead
 */
export function logProcurementError(
  error: unknown,
  context: ErrorLogContext
): void {
  errorLogger.log(error, context);
}

/**
 * Aggregate errors for batch operations
 * @deprecated Use ProcurementErrorAggregator.aggregateErrors() instead
 */
export function aggregateErrors(errors: BatchErrorItem[]) {
  return errorAggregator.aggregateErrors(errors);
}

/**
 * Validate and sanitize error context
 * @deprecated Use ProcurementErrorLogger sanitization methods instead
 */
export function sanitizeErrorContext(context: Record<string, unknown>): Record<string, unknown> {
  // Simple implementation for backward compatibility
  const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'credentials'];
  const sanitized = { ...context };

  Object.keys(sanitized).forEach(key => {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  });

  return JSON.parse(JSON.stringify(sanitized, null, 0).substring(0, 1000)) as Record<string, unknown>;
}

/**
 * Create error boundary for React components
 * @deprecated Use proper React error boundary component instead
 */
export function createErrorBoundary(
  fallbackComponent: React.ComponentType<unknown>,
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
) {
  return {
    displayName: 'ProcurementErrorBoundary',
    fallbackComponent,
    onError
  };
}

/**
 * Retry wrapper with exponential backoff for retryable errors
 * @deprecated Use ProcurementRetryService.retryOnError() instead
 */
export async function retryOnError<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  return retryService.retryOnError(operation, { maxRetries, baseDelay });
}

// Default export for backward compatibility
export { ProcurementErrorProcessor as default } from './handlers';
