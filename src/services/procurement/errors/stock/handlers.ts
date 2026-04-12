/**
 * Stock Error Handlers - Legacy Compatibility
 * Redirects to clean modular implementations
 */

// Re-export clean implementations without circular dependencies
export { InventoryHandlers } from './handlers/inventory-handlers';
export { HandlerUtils } from './handlers/handler-utils';
export type { RecoveryOption, RetryStrategy, HandlerResult, ErrorSeverity } from './types';

// Import these directly to avoid circular references
import { InsufficientStockError, StockReservationError } from './inventory';
import { StockMovementError } from './tracking';
import type {
  MovementType,
  AdjustmentType,
  MovementOptions,
  TransferOptions,
  AdjustmentOptions,
  InsufficientStockOptions,
  ExistingReservation
} from './types';

/**
 * Tracking handlers placeholder (to avoid circular import)
 */
export class TrackingHandlers {
  static handleTrackingError(error: StockMovementError) {
    return {
      error,
      recoveryOptions: [],
      severity: 'medium' as const,
      autoRecoverable: false
    };
  }
}

/**
 * Movement handlers placeholder (to avoid circular import)
 */
export class MovementHandlers {
  static handleMovementError(error: StockMovementError) {
    return {
      error,
      retryStrategies: [
        {
          type: 'exponential_backoff',
          description: 'Retry with increasing delays',
          action: 'retry_movement',
          data: { initialDelay: 1000 },
          maxAttempts: 3,
          backoffMs: 1000
        }
      ]
    };
  }
}

// Import additional error classes for factory methods
import { StockTransferError, StockAdjustmentError } from './tracking';

/** Minimal error shape for legacy formatErrorForUser */
interface LegacyStockError {
  constructor?: { name?: string };
  message?: string;
  itemCode?: string;
}

/**
 * Legacy StockErrorFactory class for backward compatibility
 * @deprecated Use StockErrorFactory from './factory' instead
 */
export class StockErrorFactory {
  static createInsufficientStockError = (
    itemCode: string,
    requestedQuantity: number,
    availableQuantity: number,
    options?: InsufficientStockOptions,
    context?: Record<string, unknown>
  ): InsufficientStockError => {
    return new InsufficientStockError(itemCode, requestedQuantity, availableQuantity, options, context);
  };

  static createMovementError = (
    message: string,
    movementType: MovementType,
    itemCode: string,
    quantity: number,
    options?: MovementOptions,
    context?: Record<string, unknown>
  ): StockMovementError => {
    return new StockMovementError(message, movementType, itemCode, quantity, options, context);
  };

  static createReservationError = (
    itemCode: string,
    requestedQuantity: number,
    availableQuantity: number,
    existingReservations: ExistingReservation[],
    context?: Record<string, unknown>
  ): StockReservationError => {
    return new StockReservationError(itemCode, requestedQuantity, availableQuantity, existingReservations, context);
  };

  static createTransferError = (
    itemCode: string,
    fromLocation: string,
    toLocation: string,
    quantity: number,
    reason: string,
    options?: TransferOptions,
    context?: Record<string, unknown>
  ): StockTransferError => {
    return new StockTransferError(itemCode, fromLocation, toLocation, quantity, reason, options, context);
  };

  static createAdjustmentError = (
    itemCode: string,
    location: string,
    adjustmentType: AdjustmentType,
    adjustmentQuantity: number,
    currentQuantity: number,
    message: string,
    options?: AdjustmentOptions,
    context?: Record<string, unknown>
  ): StockAdjustmentError => {
    return new StockAdjustmentError(
      itemCode,
      location,
      adjustmentType,
      adjustmentQuantity,
      currentQuantity,
      message,
      options,
      context
    );
  };
}

/**
 * Legacy StockErrorHandler class for backward compatibility
 * @deprecated Use StockErrorHandler from './handler-clean' instead
 */
export class StockErrorHandler {
  static handleInsufficientStock(error: InsufficientStockError) {
    // Legacy compatibility implementation
    return {
      error,
      recoveryOptions: [
        { type: 'procure_more_stock', parameters: { quantity: 100 } },
        { type: 'adjust_requirements', parameters: { newQuantity: 50 } }
      ],
      retryStrategies: [
        { type: 'exponential_backoff', maxAttempts: 3, baseDelay: 1000 }
      ],
      severity: 'high' as const,
      userDisplay: {
        title: 'Insufficient Stock',
        message: error.message,
        severity: 'error' as const,
        category: undefined,
        itemCode: error.itemCode,
        priority: undefined
      },
      systemLog: {
        timestamp: new Date(),
        errorId: `stock-${Date.now()}`,
        errorType: 'InsufficientStockError',
        severity: 'high' as const,
        message: error.message,
        details: {},
        stackTrace: undefined,
        context: undefined,
        tags: ['stock', 'insufficient']
      },
      canRetry: true,
      requiresUserIntervention: false
    };
  }

  static handleMovementError(error: StockMovementError) {
    // Return a compatible structure
    return {
      error,
      retryStrategies: [
        {
          type: 'exponential_backoff',
          description: 'Retry with increasing delays',
          action: 'retry_movement',
          data: { initialDelay: 1000 },
          maxAttempts: 3,
          backoffMs: 1000
        }
      ]
    };
  }

  static formatErrorForUser(error: LegacyStockError) {
    // Legacy compatibility implementation
    return {
      title: error.constructor?.name || 'Stock Error',
      message: error.message || 'An error occurred',
      severity: 'error' as const,
      category: undefined,
      itemCode: 'itemCode' in error ? error.itemCode : undefined,
      priority: undefined
    };
  }
}

/**
 * Legacy StockErrorAnalytics class for backward compatibility
 * @deprecated Use StockErrorAnalytics from './analytics' instead
 */
export class StockErrorAnalytics {
  static analyzeErrors() {
    return {
      patterns: [],
      trends: [],
      insights: []
    };
  }
}

// Re-export all error types for convenience
export {
  StockError,
  InsufficientStockError,
  StockReservationError
} from './inventory';

export {
  StockMovementError,
  StockTransferError,
  StockAdjustmentError,
  StockTrackingError
} from './tracking';