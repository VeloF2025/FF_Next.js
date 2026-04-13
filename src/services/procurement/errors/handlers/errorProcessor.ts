/**
 * Error Processor
 * Main error processing and response formatting logic
 */

import { ProcurementError } from '../base.errors';
import { isUserFacingError } from '../error.constants';
import { ErrorResponse, ErrorLogContext, IErrorHandler } from './types';
import { ProcurementErrorFactory } from './errorFactory';
import { ProcurementErrorLogger } from './errorLogger';

export class ProcurementErrorProcessor implements IErrorHandler {
  private logger: ProcurementErrorLogger;

  constructor() {
    this.logger = new ProcurementErrorLogger();
  }

  /**
   * Main error handler for API responses
   * Converts any error into a standardized error response format
   */
  handleError(error: unknown): ErrorResponse {
    // Handle ProcurementError and its subclasses
    if (error instanceof ProcurementError) {
      const errorJson = error.toJSON();
      const errorObj: ErrorResponse['error'] = {
        ...errorJson
      };
      
      // Only include context if it exists
      if (errorJson.context) {
        errorObj.context = errorJson.context;
      }
      
      return {
        success: false,
        error: errorObj,
        statusCode: error.statusCode
      };
    }

    // Handle database constraint errors
    if (error instanceof Error) {
      return this.handleDatabaseError(error);
    }

    // Handle generic errors
    const genericError = ProcurementErrorFactory.createProcurementError(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'An unexpected error occurred',
      { originalError: error instanceof Error ? error.stack : String(error) }
    );

    const errorJson = genericError.toJSON();
    const errorObj: ErrorResponse['error'] = {
      ...errorJson
    };
    
    // Only include context if it exists
    if (errorJson.context) {
      errorObj.context = errorJson.context;
    }

    return {
      success: false,
      error: errorObj,
      statusCode: 500
    };
  }

  /**
   * Enhanced error handler with context and user-friendly messages
   */
  handleErrorWithContext(
    error: unknown,
    context: ErrorLogContext
  ): ErrorResponse {
    const errorResponse = this.handleError(error);
    
    // Add context information
    errorResponse.error.context = {
      ...errorResponse.error.context,
      ...context
    };

    // Generate user-friendly message for user-facing errors
    if (error instanceof ProcurementError && isUserFacingError(error.code)) {
      errorResponse.error.userMessage = this.getUserFriendlyMessage(error);
    }

    // Log error based on severity
    this.logger.log(error, context);

    return errorResponse;
  }

  /**
   * Create validation error
   */
  createValidationError(field: string, message: string, value?: unknown) {
    return ProcurementErrorFactory.createValidationError(field, message, value);
  }

  /**
   * Create not found error
   */
  createNotFoundError(resourceType: string, resourceId: string, context?: Record<string, unknown>) {
    return ProcurementErrorFactory.createNotFoundError(resourceType, resourceId, context);
  }

  /**
   * Handle database-specific errors
   */
  private handleDatabaseError(error: Error): ErrorResponse {
    // Unique constraint violations
    if (error.message.includes('unique constraint') || error.message.includes('UNIQUE constraint')) {
      const constraintError = ProcurementErrorFactory.createConstraintError(
        'unique',
        error.message
      );
      return {
        success: false,
        error: constraintError.toJSON(),
        statusCode: 409
      };
    }

    // Foreign key constraint violations
    if (error.message.includes('foreign key constraint') || error.message.includes('FOREIGN KEY constraint')) {
      const constraintError = ProcurementErrorFactory.createConstraintError(
        'foreign_key',
        error.message
      );
      return {
        success: false,
        error: constraintError.toJSON(),
        statusCode: 400
      };
    }

    // Not null constraint violations
    if (error.message.includes('NOT NULL constraint') || error.message.includes('null value')) {
      const constraintError = ProcurementErrorFactory.createConstraintError(
        'not_null',
        error.message
      );
      return {
        success: false,
        error: constraintError.toJSON(),
        statusCode: 400
      };
    }

    // Network/connection errors
    if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
      const networkError = ProcurementErrorFactory.createNetworkError(error.message);
      return {
        success: false,
        error: networkError.toJSON(),
        statusCode: 502
      };
    }

    // Rate limiting errors
    if (error.message.includes('rate limit') || error.message.includes('too many requests')) {
      const rateLimitError = ProcurementErrorFactory.createNetworkError(error.message);
      return {
        success: false,
        error: rateLimitError.toJSON(),
        statusCode: 429
      };
    }

    // Default to generic error
    const genericError = ProcurementErrorFactory.createProcurementError(
      'INTERNAL_ERROR',
      error.message,
      { originalError: error.stack }
    );

    return {
      success: false,
      error: genericError.toJSON(),
      statusCode: 500
    };
  }

  /**
   * Get user-friendly error message for display in UI
   */
  private getUserFriendlyMessage(error: ProcurementError): string {
    const userFriendlyMessages: Record<string, string> = {
      'VALIDATION_ERROR': 'Please check your input and try again.',
      'NOT_FOUND': 'The requested item could not be found.',
      'INSUFFICIENT_STOCK': 'There is not enough stock available for this item.',
      'QUOTE_EXPIRED': 'This quote has expired. Please request a new quote.',
      'RFQ_DEADLINE_PASSED': 'The deadline for this request has passed.',
      'DUPLICATE_ENTRY': 'This information already exists in the system.',
      'PO_EXCEEDS_BUDGET': 'This purchase order exceeds the available budget.',
      'APPROVAL_REQUIRED': 'This action requires approval before it can be completed.',
      'INSUFFICIENT_PERMISSIONS': 'You do not have permission to perform this action.',
      'EXTERNAL_SERVICE_ERROR': 'External service is temporarily unavailable. Please try again later.',
      'API_RATE_LIMIT': 'Too many requests. Please wait a moment and try again.',
      'BUSINESS_RULE_VIOLATION': 'This action violates business rules and cannot be completed.',
      'INVALID_REFERENCE': 'The referenced item no longer exists or is not accessible.'
    };

    return userFriendlyMessages[error.code] || error.message;
  }
}