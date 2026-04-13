/**
 * Stock Errors Module - Main Entry Point
 * Comprehensive error handling for stock management operations
 */

// Re-export foundation types
export type {
  RecoveryOption,
  RetryStrategy,
  HandlerResult,
  ErrorSeverity,
  UserErrorDisplay,
  SystemErrorLog,
  ErrorAnalysisResult,
  ErrorPattern,
  ErrorTrend,
  ErrorInsight,
  StockErrorType,
  MovementType,
  AdjustmentType,
  AlternativeLocation,
  AlternativeItem,
  ExistingReservation,
  MovementOptions,
  TransferOptions,
  AdjustmentOptions,
  InsufficientStockOptions,
  TrackingOptions
} from './types';

// Re-export core error classes
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

// Import error classes for utility functions
import { StockError } from './inventory';
import type { StockErrorType } from './types';

// Re-export clean components (no circular dependencies)
export { StockErrorFactory } from './factory';
export { StockErrorHandler, ErrorRecoveryService } from './handler-clean';

// Re-export handler utilities
export { HandlerUtils, InventoryHandlers } from './handlers';

// Keep legacy components available but use clean implementations internally
export { StockErrorFormatter, type UserErrorDisplay as LegacyUserErrorDisplay, type SystemErrorLog as LegacySystemErrorLog } from './formatter';
export { StockErrorAnalytics, type ErrorPattern as LegacyErrorPattern, type ErrorTrend as LegacyErrorTrend, type ErrorInsight as LegacyErrorInsight } from './analytics';

// Note: StockErrorType is already exported from './types' above

/**
 * Check if an error is a stock-related error
 */
export function isStockError(error: unknown): error is StockError {
  return error instanceof Error && 
         (error.name === 'StockError' || 
          error.name === 'InsufficientStockError' ||
          error.name === 'StockMovementError' ||
          error.name === 'StockReservationError' ||
          error.name === 'StockTransferError' ||
          error.name === 'StockAdjustmentError' ||
          error.name === 'StockTrackingError');
}

/**
 * Get stock error type from error instance
 */
export function getStockErrorType(error: StockError): StockErrorType {
  switch (error.name) {
    case 'InsufficientStockError':
      return 'insufficient_stock';
    case 'StockMovementError':
      return 'stock_movement_failed';
    case 'StockReservationError':
      return 'stock_reservation_failed';
    case 'StockTransferError':
      return 'stock_transfer_failed';
    case 'StockAdjustmentError':
      return 'stock_adjustment_failed';
    case 'StockTrackingError':
      return 'stock_tracking_failed';
    default:
      return 'stock_movement_failed';
  }
}