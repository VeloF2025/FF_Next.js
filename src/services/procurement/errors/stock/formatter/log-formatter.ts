/**
 * Log Formatter
 * Logging and debugging formatters for stock errors
 */

import { StockError, InsufficientStockError, StockReservationError } from '../inventory';
import { StockMovementError, StockTransferError, StockAdjustmentError } from '../tracking';
import { SystemErrorLog, ErrorContext, ErrorSeverity } from './formatter-types';

/**
 * Logging and debugging formatter for stock errors
 */
export class LogFormatter {
  /**
   * Format error for system logging
   */
  static formatErrorForLogging(error: StockError, context?: ErrorContext): SystemErrorLog {
    const errorId = `STOCK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const errorType = error.constructor.name;
    
    const { severity, tags } = this.determineSeverityAndTags(error);

    return {
      timestamp: new Date(),
      errorId,
      errorType,
      severity,
      message: error.message,
      details: {
        ...error.getErrorDetails(),
        errorSource: 'StockErrorFormatter'
      },
      stackTrace: error.stack,
      context,
      tags
    };
  }

  /**
   * Determine error severity and tags based on error type and characteristics
   */
  private static determineSeverityAndTags(error: StockError): { severity: ErrorSeverity; tags: string[] } {
    let severity: ErrorSeverity = 'medium';
    const tags: string[] = ['stock', 'inventory'];

    if (error instanceof InsufficientStockError) {
      severity = error.availableQuantity === 0 ? 'high' : 'medium';
      tags.push('insufficient_stock', error.itemCode);
      
      // Critical if it's a high-value or critical item
      if (error.requestedQuantity > 1000) {
        severity = 'critical';
        tags.push('high_volume');
      }
    } else if (error instanceof StockMovementError) {
      severity = 'medium';
      tags.push('movement', error.movementType, error.itemCode);
      
      // Higher severity for large quantity movements
      if (error.quantity > 500) {
        severity = 'high';
        tags.push('large_movement');
      }
    } else if (error instanceof StockReservationError) {
      severity = 'medium';
      tags.push('reservation', error.itemCode);
      
      // Critical if reservation backlog is significant
      if (error.existingReservations.length > 10) {
        severity = 'high';
        tags.push('reservation_backlog');
      }
    } else if (error instanceof StockTransferError) {
      severity = 'medium';
      tags.push('transfer', error.itemCode, error.fromLocation, error.toLocation);
      
      // Higher severity for large transfers or critical locations
      if (error.quantity > 200) {
        severity = 'high';
        tags.push('large_transfer');
      }
    } else if (error instanceof StockAdjustmentError) {
      severity = Math.abs(error.adjustmentQuantity) > 100 ? 'high' : 'medium';
      tags.push('adjustment', error.adjustmentType, error.itemCode, error.location);
      
      // Critical for very large adjustments
      if (Math.abs(error.adjustmentQuantity) > 1000) {
        severity = 'critical';
        tags.push('large_adjustment');
      }
    }

    return { severity, tags };
  }

  /**
   * Format error for debug logging with detailed context
   */
  static formatErrorForDebug(error: StockError, context?: ErrorContext): {
    timestamp: string;
    errorId: string;
    errorClass: string;
    message: string;
    stack: string | undefined;
    details: Record<string, unknown>;
    context: Record<string, unknown> | undefined;
    diagnostics: {
      errorChain: string[];
      possibleCauses: string[];
      suggestedFixes: string[];
    };
  } {
    const errorId = `DEBUG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const diagnostics = this.generateDiagnostics(error);

    return {
      timestamp: new Date().toISOString(),
      errorId,
      errorClass: error.constructor.name,
      message: error.message,
      stack: error.stack,
      details: error.getErrorDetails(),
      context,
      diagnostics
    };
  }

  /**
   * Generate diagnostic information for debugging
   */
  private static generateDiagnostics(error: StockError): {
    errorChain: string[];
    possibleCauses: string[];
    suggestedFixes: string[];
  } {
    const errorChain = [error.constructor.name];
    let possibleCauses: string[] = [];
    let suggestedFixes: string[] = [];

    if (error instanceof InsufficientStockError) {
      possibleCauses = [
        'Stock not replenished after previous orders',
        'High demand exceeding supply forecasts',
        'Inventory tracking discrepancies',
        'Delayed supplier deliveries'
      ];
      suggestedFixes = [
        'Check reorder points and safety stock levels',
        'Review demand forecasting accuracy',
        'Perform physical inventory count',
        'Contact supplier for delivery status'
      ];
    } else if (error instanceof StockMovementError) {
      possibleCauses = [
        'Inventory system synchronization issues',
        'Concurrent stock operations',
        'Database transaction conflicts',
        'Network connectivity problems'
      ];
      suggestedFixes = [
        'Retry operation after brief delay',
        'Check database connection status',
        'Verify inventory system status',
        'Review concurrent operation logs'
      ];
    } else if (error instanceof StockReservationError) {
      possibleCauses = [
        'Expired reservations not released',
        'Concurrent reservation attempts',
        'Reservation limit exceeded',
        'System clock synchronization issues'
      ];
      suggestedFixes = [
        'Clear expired reservations',
        'Implement reservation queue system',
        'Review reservation policies',
        'Check system time synchronization'
      ];
    } else if (error instanceof StockTransferError) {
      possibleCauses = [
        'Source location insufficient stock',
        'Destination location capacity exceeded',
        'Transfer authorization missing',
        'Location connectivity issues'
      ];
      suggestedFixes = [
        'Verify stock availability at source',
        'Check destination capacity limits',
        'Confirm transfer authorizations',
        'Test location system connectivity'
      ];
    } else if (error instanceof StockAdjustmentError) {
      possibleCauses = [
        'Insufficient adjustment privileges',
        'Adjustment amount exceeds limits',
        'Physical count discrepancy',
        'Approval workflow not completed'
      ];
      suggestedFixes = [
        'Verify user adjustment permissions',
        'Request supervisor approval',
        'Perform physical recount',
        'Complete required approval steps'
      ];
    }

    return {
      errorChain,
      possibleCauses,
      suggestedFixes
    };
  }

  /**
   * Format error for audit logging (simplified)
   */
  static formatErrorForAudit(error: StockError, userId?: string, sessionId?: string) {
    const auditId = `AUDIT_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    let action = 'unknown';
    let impactLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium';

    if (error instanceof InsufficientStockError) {
      action = 'stock_allocation';
      impactLevel = error.availableQuantity === 0 ? 'high' : 'medium';
    } else if (error instanceof StockMovementError) {
      action = 'stock_movement';
    } else if (error instanceof StockTransferError) {
      action = 'stock_transfer';
    } else if (error instanceof StockAdjustmentError) {
      action = 'stock_adjustment';
      impactLevel = Math.abs(error.adjustmentQuantity) > 100 ? 'high' : 'medium';
    }

    return {
      auditId,
      timestamp: new Date().toISOString(),
      userId,
      sessionId,
      action,
      outcome: 'failure' as const,
      errorType: error.constructor.name,
      errorMessage: error.message,
      impactLevel
    };
  }

  /**
   * Format errors for performance monitoring (simplified)
   */
  static formatErrorForPerformanceMonitoring(error: StockError, executionTime?: number): {
    timestamp: string;
    errorType: string;
    operation: string;
    executionTimeMs: number | undefined;
    performanceImpact: 'low' | 'medium' | 'high';
  } {
    let operation = 'unknown_operation';
    let performanceImpact: 'low' | 'medium' | 'high' = 'low';

    if (error instanceof InsufficientStockError) {
      operation = 'stock_check';
    } else if (error instanceof StockMovementError) {
      operation = 'stock_movement';
    } else if (error instanceof StockReservationError) {
      operation = 'stock_reservation';
    } else if (error instanceof StockTransferError) {
      operation = 'stock_transfer';
      performanceImpact = 'medium';
    } else if (error instanceof StockAdjustmentError) {
      operation = 'stock_adjustment';
      performanceImpact = Math.abs(error.adjustmentQuantity) > 100 ? 'medium' : 'low';
    }

    if (executionTime && executionTime > 5000) performanceImpact = 'high';
    else if (executionTime && executionTime > 1000) performanceImpact = 'medium';

    return {
      timestamp: new Date().toISOString(),
      errorType: error.constructor.name,
      operation,
      executionTimeMs: executionTime,
      performanceImpact
    };
  }
}