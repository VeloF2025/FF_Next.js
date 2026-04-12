/**
 * Error Factory
 * Create standardized procurement errors with proper mapping
 */

import { ProcurementError, ProcurementNotFoundError } from '../base.errors';
import { RFQValidationError } from '../rfq.errors';
import { ProcurementErrorCodes, ErrorStatusCodes } from '../error.constants';

export class ProcurementErrorFactory {
  /**
   * Create a standard procurement error with proper error code mapping
   */
  static createProcurementError(
    code: keyof typeof ProcurementErrorCodes,
    message?: string,
    context?: Record<string, unknown>
  ): ProcurementError {
    const statusCode = ErrorStatusCodes[code] || 400;
    const errorMessage = message || `Procurement error: ${code}`;
    
    return new ProcurementError(errorMessage, code, statusCode, context);
  }

  /**
   * Create a validation error for form/input validation
   */
  static createValidationError(
    field: string,
    message: string,
    value?: unknown
  ): RFQValidationError {
    return new RFQValidationError(
      `Validation failed for field: ${field}`,
      [{
        path: [field],
        message,
        code: 'invalid_value',
        actualValue: value
      }],
      { field, value }
    );
  }

  /**
   * Create a not found error with resource information
   */
  static createNotFoundError(
    resourceType: string,
    resourceId: string,
    context?: Record<string, unknown>
  ): ProcurementNotFoundError {
    return new ProcurementNotFoundError(resourceType, resourceId, context);
  }

  /**
   * Create database constraint error
   */
  static createConstraintError(
    constraintType: 'unique' | 'foreign_key' | 'check' | 'not_null',
    originalMessage: string,
    context?: Record<string, unknown>
  ): ProcurementError {
    switch (constraintType) {
      case 'unique':
        return this.createProcurementError(
          'DUPLICATE_ENTRY',
          'A record with this information already exists',
          { originalError: originalMessage, ...context }
        );
      
      case 'foreign_key':
        return this.createProcurementError(
          'INVALID_REFERENCE',
          'Referenced record does not exist or cannot be modified',
          { originalError: originalMessage, ...context }
        );
      
      case 'check':
        return this.createProcurementError(
          'VALIDATION_ERROR',
          'Data does not meet required constraints',
          { originalError: originalMessage, ...context }
        );
      
      case 'not_null':
        return this.createProcurementError(
          'VALIDATION_ERROR',
          'Required field cannot be empty',
          { originalError: originalMessage, ...context }
        );
      
      default:
        return this.createProcurementError(
          'INTERNAL_ERROR',
          'Database constraint violation',
          { originalError: originalMessage, ...context }
        );
    }
  }

  /**
   * Create network/service error
   */
  static createNetworkError(originalMessage: string, context?: Record<string, unknown>): ProcurementError {
    if (originalMessage.includes('ECONNREFUSED') || originalMessage.includes('timeout')) {
      return this.createProcurementError(
        'EXTERNAL_SERVICE_ERROR',
        'External service is temporarily unavailable',
        { originalError: originalMessage, ...context }
      );
    }

    if (originalMessage.includes('rate limit') || originalMessage.includes('too many requests')) {
      return this.createProcurementError(
        'API_RATE_LIMIT',
        'Too many requests. Please try again later',
        { originalError: originalMessage, ...context }
      );
    }

    return this.createProcurementError(
      'EXTERNAL_SERVICE_ERROR',
      'Network communication error',
      { originalError: originalMessage, ...context }
    );
  }

  /**
   * Create permission error
   */
  static createPermissionError(
    operation: string,
    resource?: string,
    context?: Record<string, unknown>
  ): ProcurementError {
    const message = resource 
      ? `Insufficient permissions to ${operation} ${resource}`
      : `Insufficient permissions to ${operation}`;

    return this.createProcurementError(
      'INSUFFICIENT_PERMISSIONS',
      message,
      { operation, resource, ...context }
    );
  }

  /**
   * Create budget/limit error
   */
  static createBudgetError(
    type: 'exceeds_budget' | 'exceeds_limit' | 'insufficient_funds',
    amount?: number,
    limit?: number,
    context?: Record<string, unknown>
  ): ProcurementError {
    let code: keyof typeof ProcurementErrorCodes;
    let message: string;

    switch (type) {
      case 'exceeds_budget':
        code = 'PO_EXCEEDS_BUDGET';
        message = amount && limit 
          ? `Amount ${amount} exceeds budget limit ${limit}`
          : 'Purchase order exceeds available budget';
        break;
      
      case 'exceeds_limit':
        code = 'PO_EXCEEDS_BUDGET';
        message = amount && limit
          ? `Amount ${amount} exceeds limit ${limit}`
          : 'Operation exceeds allowed limits';
        break;
      
      case 'insufficient_funds':
        code = 'INSUFFICIENT_STOCK';
        message = 'Insufficient funds available for this operation';
        break;
      
      default:
        code = 'VALIDATION_ERROR';
        message = 'Budget constraint violation';
    }

    return this.createProcurementError(code, message, { amount, limit, ...context });
  }

  /**
   * Create business rule violation error
   */
  static createBusinessRuleError(
    rule: string,
    description?: string,
    context?: Record<string, unknown>
  ): ProcurementError {
    return this.createProcurementError(
      'VALIDATION_ERROR',
      description || `Business rule violation: ${rule}`,
      { rule, ...context }
    );
  }

  /**
   * Create deadline/expiration error
   */
  static createDeadlineError(
    type: 'expired' | 'deadline_passed' | 'too_late',
    deadline?: Date,
    context?: Record<string, unknown>
  ): ProcurementError {
    let code: keyof typeof ProcurementErrorCodes;
    let message: string;

    switch (type) {
      case 'expired':
        code = 'QUOTE_EXPIRED';
        message = deadline
          ? `Quote expired on ${deadline.toISOString().split('T')[0]}`
          : 'Quote has expired';
        break;

      case 'deadline_passed':
        code = 'RFQ_DEADLINE_PASSED';
        message = deadline
          ? `Deadline passed on ${deadline.toISOString().split('T')[0]}`
          : 'Deadline has passed';
        break;
      
      case 'too_late':
        code = 'QUOTE_EXPIRED';
        message = 'Operation cannot be completed - deadline has passed';
        break;
      
      default:
        code = 'VALIDATION_ERROR';
        message = 'Timing constraint violation';
    }

    return this.createProcurementError(code, message, { deadline, ...context });
  }
}