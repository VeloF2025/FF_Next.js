/**
 * Base Procurement Error Classes
 * Core error handling infrastructure for procurement operations
 */

/**
 * Base procurement error class with enhanced context and metadata
 */
export class ProcurementError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 400,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ProcurementError';
    this.code = code;
    this.statusCode = statusCode;
    this.timestamp = new Date();
    if (context) this.context = context;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ProcurementError.prototype);
  }

  /**
   * Convert error to JSON for API responses and logging
   */
  toJSON() {
    const result: {
      name: string;
      message: string;
      code: string;
      statusCode: number;
      timestamp: string;
      context?: Record<string, unknown>;
      [key: string]: unknown;
    } = {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp.toISOString()
    };
    
    if (this.context) {
      result.context = this.context;
    }
    
    return result;
  }

  /**
   * Get formatted error message for display
   */
  getDisplayMessage(): string {
    return this.message;
  }

  /**
   * Check if error is retryable based on status code
   */
  isRetryable(): boolean {
    // Generally, 4xx errors are not retryable, 5xx are
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  /**
   * Get error severity level
   */
  getSeverity(): 'low' | 'medium' | 'high' | 'critical' {
    if (this.statusCode >= 500) return 'critical';
    if (this.statusCode === 403 || this.statusCode === 401) return 'high';
    if (this.statusCode >= 400) return 'medium';
    return 'low';
  }
}

/**
 * Quote-specific errors
 */
export class QuoteError extends ProcurementError {
  constructor(message: string, code: string, statusCode: number = 400, context?: Record<string, unknown>) {
    super(message, code, statusCode, context);
    this.name = 'QuoteError';
    Object.setPrototypeOf(this, QuoteError.prototype);
  }
}

/**
 * Generic validation error for procurement operations
 */
export class ProcurementValidationError extends ProcurementError {
  public readonly validationErrors: Array<{
    field: string;
    message: string;
    value?: unknown;
  }>;

  constructor(
    message: string,
    validationErrors: Array<{ field: string; message: string; value?: unknown }>,
    context?: Record<string, unknown>
  ) {
    super(message, 'VALIDATION_ERROR', 422, context);
    this.name = 'ProcurementValidationError';
    this.validationErrors = validationErrors;
    Object.setPrototypeOf(this, ProcurementValidationError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      validationErrors: this.validationErrors,
      errorCount: this.validationErrors.length
    };
  }

  /**
   * Get validation errors for specific field
   */
  getFieldErrors(fieldName: string): string[] {
    return this.validationErrors
      .filter(error => error.field === fieldName)
      .map(error => error.message);
  }

  /**
   * Check if specific field has errors
   */
  hasFieldError(fieldName: string): boolean {
    return this.validationErrors.some(error => error.field === fieldName);
  }
}

/**
 * Not found error with resource information
 */
export class ProcurementNotFoundError extends ProcurementError {
  public readonly resourceType: string;
  public readonly resourceId: string;

  constructor(
    resourceType: string,
    resourceId: string,
    context?: Record<string, unknown>
  ) {
    const message = `${resourceType} with ID '${resourceId}' not found`;
    super(message, 'NOT_FOUND', 404, context);
    this.name = 'ProcurementNotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
    Object.setPrototypeOf(this, ProcurementNotFoundError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      resourceType: this.resourceType,
      resourceId: this.resourceId
    };
  }
}

/**
 * Conflict error for duplicate entries or invalid state
 */
export class ProcurementConflictError extends ProcurementError {
  public readonly conflictType: 'duplicate' | 'invalid_state' | 'version_mismatch';
  public readonly conflictDetails: Record<string, unknown> | undefined;

  constructor(
    message: string,
    conflictType: 'duplicate' | 'invalid_state' | 'version_mismatch',
    conflictDetails: Record<string, unknown> | undefined,
    context?: Record<string, unknown>
  ) {
    const code = conflictType === 'duplicate' ? 'DUPLICATE_ENTRY' : 
                 conflictType === 'version_mismatch' ? 'VERSION_CONFLICT' : 
                 'INVALID_STATE';
    
    super(message, code, 409, context);
    this.name = 'ProcurementConflictError';
    this.conflictType = conflictType;
    this.conflictDetails = conflictDetails;
    Object.setPrototypeOf(this, ProcurementConflictError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      conflictType: this.conflictType,
      conflictDetails: this.conflictDetails
    };
  }
}