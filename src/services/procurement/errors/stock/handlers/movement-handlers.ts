/**
 * Movement Error Handlers - Legacy Compatibility Layer
 * @deprecated This file has been split into modular components for better maintainability.
 * 
 * NEW STRUCTURE:
 * - movement/movement-core.ts - Core movement error handling
 * - movement/transfer-handler.ts - Transfer-specific error handling
 * - movement/movement-utils.ts - Utility functions for movement operations
 * - movement/movement-executor.ts - Retry strategy execution
 * 
 * Please use the new modular imports:
 * import { MovementCore, TransferHandler, MovementUtils, MovementExecutor } from './movement';
 * 
 * This file will be removed in a future version. Use the modular structure instead.
 */

// Import from new modular structure for backward compatibility
import { MovementCore, TransferHandler, MovementExecutor } from './movement';
import { StockMovementError, StockTransferError } from '../tracking';
import type { RetryStrategy } from '../types';

// Re-export types from new modular structure
export type { RetryStrategy } from './movement';

/**
 * Legacy MovementHandlers class for backward compatibility
 * @deprecated Use MovementCore and TransferHandler from './movement' instead
 */
export class MovementHandlers {
  /**
   * Handle stock movement errors with comprehensive retry strategies
   * @deprecated Use MovementCore.handleMovementError() instead
   */
  static handleMovementError(error: StockMovementError): {
    error: StockMovementError;
    retryStrategies: RetryStrategy[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    autoRecoverable: boolean;
  } {
    // Delegate to new modular handler
    return MovementCore.handleMovementError(error);
  }

  /**
   * Handle stock transfer errors with routing and scheduling strategies
   * @deprecated Use TransferHandler.handleTransferError() instead
   */
  static handleTransferError(error: StockTransferError): {
    error: StockTransferError;
    retryStrategies: RetryStrategy[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    autoRecoverable: boolean;
  } {
    // Delegate to new modular handler
    return TransferHandler.handleTransferError(error);
  }

  /**
   * Execute movement retry strategy
   * @deprecated Use MovementExecutor.executeRetry() instead
   */
  static async executeRetry(retryStrategy: RetryStrategy): Promise<{
    success: boolean;
    result: Record<string, unknown> | undefined;
    error: string | undefined;
    shouldRetry: boolean | undefined;
  }> {
    // Delegate to new modular executor
    return MovementExecutor.executeRetry(retryStrategy);
  }
}
