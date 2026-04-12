/**
 * Stock Error Formatter - Legacy Compatibility Layer
 * Clean implementation without circular dependencies
 */

import { StockError } from './inventory';
import type { UserErrorDisplay, SystemErrorLog } from './types';

/** Narrow type for stock errors that carry an item code */
interface StockErrorWithItemCode extends StockError {
  readonly itemCode?: string;
}

// Re-export types for backward compatibility
export type { UserErrorDisplay, SystemErrorLog } from './types';

/**
 * Stock Error Formatter class
 * Clean implementation without circular references
 */
export class StockErrorFormatter {
  /**
   * Format error for user display
   */
  static formatForUser(error: StockError): UserErrorDisplay {
    const errorType = error.constructor.name;
    
    switch (errorType) {
      case 'InsufficientStockError':
        return {
          title: 'Insufficient Stock',
          message: `Not enough stock available for item ${(error as StockErrorWithItemCode).itemCode}`,
          severity: 'error',
          category: 'inventory',
          itemCode: (error as StockErrorWithItemCode).itemCode,
          priority: 'high'
        };

      case 'StockReservationError':
        return {
          title: 'Stock Reservation Failed',
          message: `Cannot reserve stock for item ${(error as StockErrorWithItemCode).itemCode}`,
          severity: 'warning',
          category: 'reservation',
          itemCode: (error as StockErrorWithItemCode).itemCode,
          priority: 'medium'
        };

      case 'StockMovementError':
        return {
          title: 'Stock Movement Failed',
          message: `Stock movement operation failed: ${error.message}`,
          severity: 'error',
          category: 'movement',
          itemCode: (error as StockErrorWithItemCode).itemCode,
          priority: 'medium'
        };

      case 'StockTransferError':
        return {
          title: 'Stock Transfer Failed',
          message: `Transfer operation failed: ${error.message}`,
          severity: 'error',
          category: 'transfer',
          itemCode: (error as StockErrorWithItemCode).itemCode,
          priority: 'medium'
        };

      case 'StockAdjustmentError':
        return {
          title: 'Stock Adjustment Failed',
          message: `Adjustment operation failed: ${error.message}`,
          severity: 'warning',
          category: 'adjustment',
          itemCode: (error as StockErrorWithItemCode).itemCode,
          priority: 'low'
        };

      case 'StockTrackingError':
        return {
          title: 'Stock Tracking Error',
          message: `Tracking operation failed: ${error.message}`,
          severity: 'info',
          category: 'tracking',
          itemCode: (error as StockErrorWithItemCode).itemCode,
          priority: 'low'
        };

      default:
        return {
          title: 'Stock Error',
          message: error.message,
          severity: 'error',
          category: 'general',
          itemCode: undefined,
          priority: 'medium'
        };
    }
  }

  /**
   * Format error for system logging
   */
  static formatForLogging(error: StockError): SystemErrorLog {
    return {
      timestamp: new Date(),
      errorId: `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      errorType: error.constructor.name,
      severity: 'medium',
      message: error.message,
      details: error.getErrorDetails() || {
        errorType: error.constructor.name,
        message: error.message,
        timestamp: new Date().toISOString()
      },
      stackTrace: error.stack,
      context: error.context,
      tags: ['stock', 'error', error.constructor.name.toLowerCase()]
    };
  }

  /**
   * Format error as plain text
   */
  static formatAsText(error: StockError): string {
    const userDisplay = this.formatForUser(error);
    return `[${userDisplay.severity.toUpperCase()}] ${userDisplay.title}: ${userDisplay.message}`;
  }

  /**
   * Format error as JSON
   */
  static formatAsJSON(error: StockError): string {
    const logFormat = this.formatForLogging(error);
    return JSON.stringify(logFormat, null, 2);
  }
}

// Legacy aliases for backward compatibility
export const CoreErrorFormatter = StockErrorFormatter;
export const DisplayFormatter = StockErrorFormatter;
export const LogFormatter = StockErrorFormatter;