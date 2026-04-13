/**
 * Clean Stock Error Handler
 * Main handler interface without circular dependencies
 */

import { StockError, InsufficientStockError, StockReservationError } from './inventory';
import { StockMovementError, StockTransferError, StockAdjustmentError, StockTrackingError } from './tracking';
import { InventoryHandlers } from './handlers/inventory-handlers';
import { HandlerUtils } from './handlers/handler-utils';
import type { 
  RecoveryOption, 
  RetryStrategy, 
  HandlerResult, 
  UserErrorDisplay
} from './types';

/**
 * Main stock error handler class
 */
export class StockErrorHandler {
  /**
   * Handle insufficient stock error with recovery options
   */
  static handleInsufficientStock(error: InsufficientStockError): HandlerResult<InsufficientStockError> {
    const result = InventoryHandlers.handleInsufficientStock(error);
    return {
      error: result.error,
      recoveryOptions: result.recoveryOptions,
      retryStrategies: [],
      severity: result.severity,
      autoRecoverable: result.autoRecoverable,
      requiresManualIntervention: !result.autoRecoverable
    };
  }

  /**
   * Handle stock reservation error with cleanup and queuing options
   */
  static handleReservationError(error: StockReservationError): HandlerResult<StockReservationError> {
    const result = InventoryHandlers.handleReservationError(error);
    return {
      error: result.error,
      recoveryOptions: result.recoveryOptions,
      retryStrategies: [],
      severity: result.severity,
      autoRecoverable: result.autoRecoverable,
      requiresManualIntervention: !result.autoRecoverable
    };
  }

  /**
   * Handle stock movement error with retry strategies
   */
  static handleMovementError(error: StockMovementError): HandlerResult<StockMovementError> {
    const retryStrategies: RetryStrategy[] = [
      {
        type: 'exponential_backoff',
        description: 'Retry with increasing delays',
        action: 'retry_movement',
        data: {
          initialDelay: 1000,
          maxAttempts: 3,
          backoffMultiplier: 2
        },
        maxAttempts: 3,
        backoffMs: 1000,
        estimatedTime: '30 seconds'
      },
      {
        type: 'alternative_route',
        description: 'Try alternative movement path',
        action: 'try_alternative_route',
        data: {
          alternativeLocations: []
        },
        estimatedTime: '2-5 minutes'
      }
    ];

    const severity = HandlerUtils.determineSeverity(error, {
      businessImpact: 'medium',
      customerImpact: false
    });

    return {
      error,
      recoveryOptions: [],
      retryStrategies,
      severity,
      autoRecoverable: HandlerUtils.isAutoRecoverable(error),
      requiresManualIntervention: false
    };
  }

  /**
   * Handle stock transfer error
   */
  static handleTransferError(error: StockTransferError): HandlerResult<StockTransferError> {
    const retryStrategies: RetryStrategy[] = [
      {
        type: 'retry_transfer',
        description: 'Retry the transfer operation',
        action: 'retry_transfer',
        data: {
          transferId: error.transferId,
          fromLocation: error.fromLocation,
          toLocation: error.toLocation
        },
        maxAttempts: 2,
        estimatedTime: '1-2 minutes'
      }
    ];

    const severity = HandlerUtils.determineSeverity(error, {
      businessImpact: 'medium'
    });

    return {
      error,
      recoveryOptions: [],
      retryStrategies,
      severity,
      autoRecoverable: HandlerUtils.isAutoRecoverable(error),
      requiresManualIntervention: false
    };
  }

  /**
   * Handle stock adjustment error
   */
  static handleAdjustmentError(error: StockAdjustmentError): HandlerResult<StockAdjustmentError> {
    const recoveryOptions: RecoveryOption[] = [
      {
        type: 'manual_review',
        description: 'Submit for manual review and verification',
        action: 'request_manual_review',
        data: {
          itemCode: error.itemCode,
          location: error.location,
          adjustmentType: error.adjustmentType
        },
        estimatedTime: '10-30 minutes'
      }
    ];

    return {
      error,
      recoveryOptions,
      retryStrategies: [],
      severity: 'low',
      autoRecoverable: false,
      requiresManualIntervention: true
    };
  }

  /**
   * Handle stock tracking error
   */
  static handleTrackingError(error: StockTrackingError): HandlerResult<StockTrackingError> {
    const retryStrategies: RetryStrategy[] = [
      {
        type: 'simple_retry',
        description: 'Retry tracking operation',
        action: 'retry_tracking',
        data: {
          trackingId: error.trackingId,
          operationType: error.operationType
        },
        maxAttempts: 3,
        backoffMs: 500,
        estimatedTime: '10 seconds'
      }
    ];

    return {
      error,
      recoveryOptions: [],
      retryStrategies,
      severity: 'low',
      autoRecoverable: true,
      requiresManualIntervention: false
    };
  }

  /**
   * Format error for user display
   */
  static formatErrorForUser(error: StockError): UserErrorDisplay {
    return HandlerUtils.formatErrorForUser(error);
  }

  /**
   * Format error for system logging
   */
  static formatErrorForLogging(error: StockError): string {
    return HandlerUtils.formatForLogging(error);
  }

  /**
   * Handle any stock error generically
   */
  static handleError(error: StockError): HandlerResult<StockError> {
    if (error instanceof InsufficientStockError) {
      return this.handleInsufficientStock(error);
    } else if (error instanceof StockReservationError) {
      return this.handleReservationError(error);
    } else if (error instanceof StockMovementError) {
      return this.handleMovementError(error);
    } else if (error instanceof StockTransferError) {
      return this.handleTransferError(error);
    } else if (error instanceof StockAdjustmentError) {
      return this.handleAdjustmentError(error);
    } else if (error instanceof StockTrackingError) {
      return this.handleTrackingError(error);
    } else {
      // Generic handling for unknown stock error types
      return {
        error,
        recoveryOptions: [],
        retryStrategies: [],
        severity: 'medium',
        autoRecoverable: false,
        requiresManualIntervention: true
      };
    }
  }
}

/**
 * Error recovery execution service
 */
export class ErrorRecoveryService {
  /**
   * Execute a recovery option
   */
  static async executeRecovery(recoveryOption: RecoveryOption): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
  }> {
    try {

      // This would typically interface with actual recovery systems
      // For now, return a mock successful execution
      return {
        success: true,
        result: {
          action: recoveryOption.action,
          type: recoveryOption.type,
          executedAt: new Date().toISOString(),
          data: recoveryOption.data
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during recovery execution'
      };
    }
  }

  /**
   * Execute a retry strategy
   */
  static async executeRetry(retryStrategy: RetryStrategy, attemptNumber: number = 1): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    shouldRetry?: boolean;
  }> {
    try {

      // Check if we've exceeded max attempts
      if (retryStrategy.maxAttempts && attemptNumber > retryStrategy.maxAttempts) {
        return {
          success: false,
          shouldRetry: false,
          error: 'Maximum retry attempts exceeded'
        };
      }

      // Apply backoff delay if specified
      if (retryStrategy.backoffMs && attemptNumber > 1) {
        const delay = HandlerUtils.calculateRetryDelay(attemptNumber, retryStrategy.backoffMs);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // This would typically interface with actual retry systems
      // For now, return a mock execution
      return {
        success: true,
        shouldRetry: false,
        result: {
          action: retryStrategy.action,
          type: retryStrategy.type,
          attemptNumber,
          executedAt: new Date().toISOString(),
          data: retryStrategy.data
        }
      };
    } catch (error) {
      const shouldRetry = retryStrategy.maxAttempts 
        ? attemptNumber < retryStrategy.maxAttempts 
        : false;

      return {
        success: false,
        shouldRetry,
        error: error instanceof Error ? error.message : 'Unknown error during retry execution'
      };
    }
  }
}

// Re-export types and utilities for convenience
export type { 
  RecoveryOption, 
  RetryStrategy, 
  HandlerResult, 
  ErrorSeverity, 
  UserErrorDisplay, 
  SystemErrorLog 
} from './types';

export { HandlerUtils } from './handlers/handler-utils';
export { InventoryHandlers } from './handlers/inventory-handlers';