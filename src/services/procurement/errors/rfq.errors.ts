/**
 * RFQ (Request for Quotation) Specific Error Classes
 * Error handling for RFQ operations, validation, and supplier management
 */

import { ProcurementError } from './base.errors';

/**
 * RFQ-specific base error class
 */
export class RFQError extends ProcurementError {
  constructor(message: string, code: string, statusCode: number = 400, context?: Record<string, any>) {
    super(message, code, statusCode, context);
    this.name = 'RFQError';
    Object.setPrototypeOf(this, RFQError.prototype);
  }
}

/**
 * RFQ Validation errors with detailed validation issues
 */
export class RFQValidationError extends RFQError {
  public readonly validationErrors: Array<{
    path: (string | number)[];
    message: string;
    code: string;
    expectedType?: string;
    actualValue?: any;
  }>;

  constructor(
    message: string,
    validationErrors: Array<{ 
      path: (string | number)[]; 
      message: string; 
      code: string;
      expectedType?: string;
      actualValue?: any;
    }>,
    context?: Record<string, any>
  ) {
    super(message, 'RFQ_VALIDATION_ERROR', 422, context);
    this.name = 'RFQValidationError';
    this.validationErrors = validationErrors;
    Object.setPrototypeOf(this, RFQValidationError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      validationErrors: this.validationErrors,
      errorCount: this.validationErrors.length,
      fieldsSummary: this.getFieldsSummary()
    };
  }

  /**
   * Get validation errors by field path
   */
  getErrorsByPath(path: string): Array<{ message: string; code: string }> {
    return this.validationErrors
      .filter(error => error.path.join('.') === path)
      .map(error => ({ message: error.message, code: error.code }));
  }

  /**
   * Get summary of fields with errors
   */
  getFieldsSummary(): string[] {
    return [...new Set(this.validationErrors.map(error => error.path.join('.')))];
  }

  /**
   * Check if specific field has errors
   */
  hasPathError(path: string): boolean {
    return this.validationErrors.some(error => error.path.join('.') === path);
  }
}

/**
 * RFQ State error for invalid operations based on current state
 */
export class RFQStateError extends RFQError {
  public readonly currentState: string;
  public readonly requestedOperation: string;
  public readonly allowedOperations: string[];
  public readonly stateTransitions?: Record<string, string[]> | undefined;

  constructor(
    currentState: string,
    requestedOperation: string,
    allowedOperations: string[],
    stateTransitions?: Record<string, string[]>,
    context?: Record<string, any>
  ) {
    const message = `Cannot perform '${requestedOperation}' on RFQ in '${currentState}' state. Allowed operations: ${allowedOperations.join(', ')}`;
    super(message, 'RFQ_INVALID_STATE', 409, context);
    this.name = 'RFQStateError';
    this.currentState = currentState;
    this.requestedOperation = requestedOperation;
    this.allowedOperations = allowedOperations;
    this.stateTransitions = stateTransitions || undefined;
    Object.setPrototypeOf(this, RFQStateError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      currentState: this.currentState,
      requestedOperation: this.requestedOperation,
      allowedOperations: this.allowedOperations,
      stateTransitions: this.stateTransitions
    };
  }

  /**
   * Get possible next states from current state
   */
  getPossibleNextStates(): string[] {
    if (!this.stateTransitions) return [];
    return this.stateTransitions[this.currentState] || [];
  }
}

/**
 * RFQ Deadline error for time-related constraints
 */
export class RFQDeadlineError extends RFQError {
  public readonly deadline: Date;
  public readonly currentTime: Date;
  public readonly operation: string;

  constructor(
    deadline: Date,
    operation: string,
    context?: Record<string, any>
  ) {
    const currentTime = new Date();
    const timeRemaining = deadline.getTime() - currentTime.getTime();
    const isPastDeadline = timeRemaining < 0;
    
    const message = isPastDeadline 
      ? `Cannot ${operation}: RFQ deadline has passed (${deadline.toISOString()})`
      : `Cannot ${operation}: RFQ deadline is too close (${Math.round(timeRemaining / (1000 * 60))} minutes remaining)`;
    
    super(message, 'RFQ_DEADLINE_PASSED', 410, context);
    this.name = 'RFQDeadlineError';
    this.deadline = deadline;
    this.currentTime = currentTime;
    this.operation = operation;
    Object.setPrototypeOf(this, RFQDeadlineError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      deadline: this.deadline.toISOString(),
      currentTime: this.currentTime.toISOString(),
      operation: this.operation,
      timeRemaining: this.getTimeRemaining(),
      isPastDeadline: this.isPastDeadline()
    };
  }

  /**
   * Get time remaining until deadline in milliseconds
   */
  getTimeRemaining(): number {
    return this.deadline.getTime() - this.currentTime.getTime();
  }

  /**
   * Check if deadline has passed
   */
  isPastDeadline(): boolean {
    return this.getTimeRemaining() < 0;
  }

  /**
   * Get formatted time remaining string
   */
  getFormattedTimeRemaining(): string {
    const timeRemaining = this.getTimeRemaining();
    
    if (timeRemaining < 0) {
      return 'Deadline passed';
    }
    
    const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days} days, ${hours} hours`;
    if (hours > 0) return `${hours} hours, ${minutes} minutes`;
    return `${minutes} minutes`;
  }
}

/**
 * RFQ Supplier error for supplier-related issues
 */
export class RFQSupplierError extends RFQError {
  public readonly supplierIds: string[];
  public readonly issueType: 'not_invited' | 'no_suppliers' | 'supplier_declined' | 'invalid_supplier';
  public readonly availableSuppliers: Array<{
    id: string;
    name: string;
    category: string;
    rating?: number;
  }> | undefined;

  constructor(
    message: string,
    supplierIds: string[],
    issueType: 'not_invited' | 'no_suppliers' | 'supplier_declined' | 'invalid_supplier',
    availableSuppliers: Array<{
      id: string;
      name: string;
      category: string;
      rating?: number;
    }> | undefined,
    context?: Record<string, any>
  ) {
    const code = issueType === 'no_suppliers' ? 'RFQ_NO_SUPPLIERS' : 'RFQ_SUPPLIER_ERROR';
    super(message, code, 400, context);
    this.name = 'RFQSupplierError';
    this.supplierIds = supplierIds;
    this.issueType = issueType;
    this.availableSuppliers = availableSuppliers;
    Object.setPrototypeOf(this, RFQSupplierError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      supplierIds: this.supplierIds,
      issueType: this.issueType,
      availableSuppliers: this.availableSuppliers,
      suggestedSuppliers: this.getSuggestedSuppliers()
    };
  }

  /**
   * Get suggested suppliers based on rating
   */
  getSuggestedSuppliers(minRating: number = 4.0) {
    if (!this.availableSuppliers) return [];
    
    return this.availableSuppliers
      .filter(supplier => (supplier.rating || 0) >= minRating)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 5); // Top 5 suggestions
  }

  /**
   * Get suppliers by category
   */
  getSuppliersByCategory(): Record<string, Array<{ id: string; name: string; rating?: number }>> {
    if (!this.availableSuppliers) return {};
    
    return this.availableSuppliers.reduce((acc, supplier) => {
      if (!acc[supplier.category]) acc[supplier.category] = [];
      const supplierItem: { id: string; name: string; rating?: number } = {
        id: supplier.id,
        name: supplier.name
      };
      if (supplier.rating !== undefined) {
        supplierItem.rating = supplier.rating;
      }
      acc[supplier.category]!.push(supplierItem);
      return acc;
    }, {} as Record<string, Array<{ id: string; name: string; rating?: number }>>);
  }
}