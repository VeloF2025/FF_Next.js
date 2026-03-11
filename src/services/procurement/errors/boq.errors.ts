/**
 * BOQ (Bill of Quantities) Specific Error Classes
 * Error handling for BOQ operations, mapping, and validation
 */

import { ProcurementError } from './base.errors';

/**
 * BOQ-specific base error class
 */
export class BOQError extends ProcurementError {
  constructor(message: string, code: string, statusCode: number = 400, context?: Record<string, any>) {
    super(message, code, statusCode, context);
    this.name = 'BOQError';
    Object.setPrototypeOf(this, BOQError.prototype);
  }
}

/**
 * BOQ Mapping errors with detailed exception information
 * Used when BOQ items cannot be mapped to catalog items
 */
export class BOQMappingError extends BOQError {
  public readonly unmappedItems: Array<{
    lineNumber: number;
    description: string;
    reason: string;
    originalData?: Record<string, any>;
  }>;
  public readonly suggestions: Array<{
    lineNumber: number;
    catalogItems: Array<{
      id: string;
      name: string;
      confidence: number;
      category?: string;
      unitPrice?: number;
    }>;
  }>;

  constructor(
    message: string,
    unmappedItems: Array<{ 
      lineNumber: number; 
      description: string; 
      reason: string;
      originalData?: Record<string, any>;
    }>,
    suggestions: Array<{ 
      lineNumber: number; 
      catalogItems: Array<{ 
        id: string; 
        name: string; 
        confidence: number;
        category?: string;
        unitPrice?: number;
      }> 
    }>,
    context?: Record<string, any>
  ) {
    super(message, 'BOQ_MAPPING_ERROR', 422, context);
    this.name = 'BOQMappingError';
    this.unmappedItems = unmappedItems;
    this.suggestions = suggestions;
    Object.setPrototypeOf(this, BOQMappingError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      unmappedItems: this.unmappedItems,
      suggestions: this.suggestions,
      unmappedCount: this.unmappedItems.length,
      mappingRate: this.getMappingSuccessRate()
    };
  }

  /**
   * Get mapping success rate as percentage
   */
  getMappingSuccessRate(): number {
    const totalItems = this.unmappedItems.length + (this.context?.totalMappedItems || 0);
    if (totalItems === 0) return 0;
    
    const mappedItems = this.context?.totalMappedItems || 0;
    return Math.round((mappedItems / totalItems) * 100);
  }

  /**
   * Get unmapped items by reason
   */
  getUnmappedByReason(): Record<string, Array<{ lineNumber: number; description: string }>> {
    return this.unmappedItems.reduce((acc, item) => {
      if (!acc[item.reason]) acc[item.reason] = [];
      acc[item.reason]!.push({
        lineNumber: item.lineNumber,
        description: item.description
      });
      return acc;
    }, {} as Record<string, Array<{ lineNumber: number; description: string }>>);
  }

  /**
   * Get suggestions with high confidence (>80%)
   */
  getHighConfidenceSuggestions() {
    return this.suggestions.filter(suggestion =>
      suggestion.catalogItems.some(item => item.confidence > 0.8)
    );
  }
}

/**
 * BOQ Import errors for file processing issues
 */
export class BOQImportError extends BOQError {
  public readonly importErrors: Array<{
    row: number;
    column: string;
    error: string;
    severity: 'error' | 'warning';
  }>;
  public readonly fileInfo?: {
    fileName: string;
    fileSize: number;
    totalRows: number;
    processedRows: number;
  } | undefined;

  constructor(
    message: string,
    importErrors: Array<{
      row: number;
      column: string;
      error: string;
      severity: 'error' | 'warning';
    }>,
    fileInfo?: {
      fileName: string;
      fileSize: number;
      totalRows: number;
      processedRows: number;
    },
    context?: Record<string, any>
  ) {
    super(message, 'BOQ_IMPORT_FAILED', 400, context);
    this.name = 'BOQImportError';
    this.importErrors = importErrors;
    this.fileInfo = fileInfo || undefined;
    Object.setPrototypeOf(this, BOQImportError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      importErrors: this.importErrors,
      fileInfo: this.fileInfo || undefined,
      errorCount: this.importErrors.filter(e => e.severity === 'error').length,
      warningCount: this.importErrors.filter(e => e.severity === 'warning').length
    };
  }

  /**
   * Get errors by severity level
   */
  getErrorsBySeverity(severity: 'error' | 'warning') {
    return this.importErrors.filter(error => error.severity === severity);
  }

  /**
   * Get unique columns with errors
   */
  getErrorColumns(): string[] {
    return [...new Set(this.importErrors.map(error => error.column))];
  }
}

/**
 * BOQ Version conflict error
 */
export class BOQVersionError extends BOQError {
  public readonly currentVersion: number;
  public readonly requestedVersion: number;
  public readonly latestVersion: number;

  constructor(
    currentVersion: number,
    requestedVersion: number,
    latestVersion: number,
    context?: Record<string, any>
  ) {
    const message = `BOQ version conflict. Current: ${currentVersion}, Requested: ${requestedVersion}, Latest: ${latestVersion}`;
    super(message, 'BOQ_INVALID_VERSION', 409, context);
    this.name = 'BOQVersionError';
    this.currentVersion = currentVersion;
    this.requestedVersion = requestedVersion;
    this.latestVersion = latestVersion;
    Object.setPrototypeOf(this, BOQVersionError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      currentVersion: this.currentVersion,
      requestedVersion: this.requestedVersion,
      latestVersion: this.latestVersion,
      isOutdated: this.currentVersion < this.latestVersion
    };
  }

  /**
   * Check if the requested version is outdated
   */
  isRequestedVersionOutdated(): boolean {
    return this.requestedVersion < this.latestVersion;
  }
}

/**
 * BOQ State error for invalid operations
 */
export class BOQStateError extends BOQError {
  public readonly currentState: string;
  public readonly requestedOperation: string;
  public readonly allowedOperations: string[];

  constructor(
    currentState: string,
    requestedOperation: string,
    allowedOperations: string[],
    context?: Record<string, any>
  ) {
    const message = `Invalid BOQ operation '${requestedOperation}' in state '${currentState}'. Allowed operations: ${allowedOperations.join(', ')}`;
    super(message, 'BOQ_INVALID_STATE', 409, context);
    this.name = 'BOQStateError';
    this.currentState = currentState;
    this.requestedOperation = requestedOperation;
    this.allowedOperations = allowedOperations;
    Object.setPrototypeOf(this, BOQStateError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      currentState: this.currentState,
      requestedOperation: this.requestedOperation,
      allowedOperations: this.allowedOperations
    };
  }
}