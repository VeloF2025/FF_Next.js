/**
 * Display Formatter
 * UI/display formatting and visualization helpers for stock errors
 */

import { StockError, InsufficientStockError } from '../inventory';
import { StockMovementError, StockTransferError, StockAdjustmentError } from '../tracking';
import { MultipleErrorsResult, ErrorReport } from './formatter-types';
import { CoreErrorFormatter } from './error-formatter';

/**
 * Display and UI formatting utilities for stock errors
 */
export class DisplayFormatter {
  /**
   * Format multiple errors for bulk display
   */
  static formatMultipleErrors(errors: StockError[]): MultipleErrorsResult {
    const byType: Record<string, number> = {};
    let hasErrors = false;

    errors.forEach(error => {
      const type = error.constructor.name;
      byType[type] = (byType[type] || 0) + 1;
      
      if (error instanceof InsufficientStockError && error.availableQuantity === 0) {
        hasErrors = true;
      } else if (!(error instanceof InsufficientStockError)) {
        hasErrors = true;
      }
    });

    return {
      summary: {
        total: errors.length,
        byType,
        severity: hasErrors ? 'error' : 'warning'
      },
      errors: errors.map(error => CoreErrorFormatter.formatErrorForUser(error))
    };
  }

  /**
   * Generate comprehensive error report for analysis and reporting
   */
  static generateErrorReport(errors: StockError[], timeRange: { start: Date; end: Date }): ErrorReport {
    const reportId = `STOCK_ERROR_REPORT_${Date.now()}`;
    const errorsByType: Record<string, number> = {};
    const errorsByItem: Record<string, number> = {};
    const errorsByLocation: Record<string, number> = {};

    errors.forEach(error => {
      // Count by type
      const type = error.constructor.name;
      errorsByType[type] = (errorsByType[type] || 0) + 1;

      // Count by item (if available)
      if ('itemCode' in error && error.itemCode && typeof error.itemCode === 'string') {
        errorsByItem[error.itemCode] = (errorsByItem[error.itemCode] || 0) + 1;
      }

      // Count by location (if available)
      if ('location' in error && error.location && typeof error.location === 'string') {
        errorsByLocation[error.location] = (errorsByLocation[error.location] || 0) + 1;
      } else if ('fromLocation' in error && error.fromLocation && typeof error.fromLocation === 'string') {
        errorsByLocation[error.fromLocation] = (errorsByLocation[error.fromLocation] || 0) + 1;
      }
    });

    // Generate recommendations based on error patterns
    const recommendations = this.generateRecommendations(errors, errorsByType);

    // Get most problematic items and locations
    const mostProblematicItems = this.getMostProblematicItems(errors, errorsByItem);
    const mostProblematicLocations = this.getMostProblematicLocations(errors, errorsByLocation);

    return {
      reportId,
      generatedAt: new Date(),
      timeRange,
      summary: {
        totalErrors: errors.length,
        errorsByType,
        errorsByItem,
        errorsByLocation
      },
      trends: {
        errorRateByHour: [], // Would need timestamp data from errors
        mostProblematicItems,
        mostProblematicLocations
      },
      recommendations
    };
  }

  /**
   * Generate actionable recommendations based on error patterns
   */
  private static generateRecommendations(errors: StockError[], errorsByType: Record<string, number>): string[] {
    const recommendations: string[] = [];
    const totalErrors = errors.length;
    
    if ((errorsByType.InsufficientStockError ?? 0) > totalErrors * 0.3) {
      recommendations.push('Consider implementing automatic reorder points for frequently out-of-stock items');
    }
    
    if ((errorsByType.StockMovementError ?? 0) > totalErrors * 0.2) {
      recommendations.push('Review stock movement processes for efficiency improvements');
    }

    if ((errorsByType.StockTransferError ?? 0) > totalErrors * 0.15) {
      recommendations.push('Audit inter-location transfer procedures and infrastructure');
    }

    if ((errorsByType.StockAdjustmentError ?? 0) > totalErrors * 0.1) {
      recommendations.push('Implement more frequent cycle counts to reduce adjustment discrepancies');
    }

    if ((errorsByType.StockReservationError ?? 0) > totalErrors * 0.2) {
      recommendations.push('Review reservation policies and implement reservation queue system');
    }

    return recommendations;
  }

  /**
   * Get most problematic items for trend analysis
   */
  private static getMostProblematicItems(errors: StockError[], errorsByItem: Record<string, number>) {
    return Object.entries(errorsByItem)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([itemCode, count]) => ({
        itemCode,
        count,
        errorTypes: errors
          .filter(e => 'itemCode' in e && e.itemCode === itemCode)
          .map(e => e.constructor.name)
          .filter((type, index, arr) => arr.indexOf(type) === index)
      }));
  }

  /**
   * Get most problematic locations for trend analysis
   */
  private static getMostProblematicLocations(errors: StockError[], errorsByLocation: Record<string, number>) {
    return Object.entries(errorsByLocation)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([location, count]) => ({
        location,
        count,
        errorTypes: errors
          .filter(e => ('location' in e && e.location === location) || 
                      ('fromLocation' in e && e.fromLocation === location))
          .map(e => e.constructor.name)
          .filter((type, index, arr) => arr.indexOf(type) === index)
      }));
  }

  /**
   * Format error summary for dashboard display
   */
  static formatErrorSummary(errors: StockError[]): {
    criticalCount: number;
    warningCount: number;
    totalCount: number;
    topErrorType: string | null;
    affectedItemsCount: number;
    affectedLocationsCount: number;
  } {
    let criticalCount = 0;
    let warningCount = 0;
    const errorTypes: Record<string, number> = {};
    const affectedItems = new Set<string>();
    const affectedLocations = new Set<string>();

    errors.forEach(error => {
      // Count severity
      if (error instanceof InsufficientStockError && error.availableQuantity === 0) {
        criticalCount++;
      } else if (error instanceof InsufficientStockError) {
        warningCount++;
      } else {
        criticalCount++;
      }

      // Track error types
      const type = error.constructor.name;
      errorTypes[type] = (errorTypes[type] || 0) + 1;

      // Track affected items and locations
      if ('itemCode' in error && error.itemCode && typeof error.itemCode === 'string') {
        affectedItems.add(error.itemCode);
      }
      
      if ('location' in error && error.location && typeof error.location === 'string') {
        affectedLocations.add(error.location);
      } else if ('fromLocation' in error && error.fromLocation && typeof error.fromLocation === 'string') {
        affectedLocations.add(error.fromLocation);
      }
      
      if ('toLocation' in error && error.toLocation && typeof error.toLocation === 'string') {
        affectedLocations.add(error.toLocation);
      }
    });

    // Find most common error type
    const topErrorType = Object.entries(errorTypes)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

    return {
      criticalCount,
      warningCount,
      totalCount: errors.length,
      topErrorType,
      affectedItemsCount: affectedItems.size,
      affectedLocationsCount: affectedLocations.size
    };
  }

  /**
   * Format error for notification display
   */
  static formatErrorForNotification(error: StockError): {
    title: string;
    message: string;
    priority: 'high' | 'medium' | 'low';
    category: string;
    itemCode?: string;
  } {
    let priority: 'high' | 'medium' | 'low' = 'medium';
    let category = 'stock';
    let itemCode: string | undefined;

    if (error instanceof InsufficientStockError) {
      priority = error.availableQuantity === 0 ? 'high' : 'medium';
      category = 'inventory';
      itemCode = error.itemCode;
    } else if (error instanceof StockMovementError) {
      priority = 'medium';
      category = 'movement';
      itemCode = error.itemCode;
    } else if (error instanceof StockTransferError) {
      priority = 'medium';
      category = 'transfer';
      itemCode = error.itemCode;
    } else if (error instanceof StockAdjustmentError) {
      priority = Math.abs(error.adjustmentQuantity) > 100 ? 'high' : 'medium';
      category = 'adjustment';
      itemCode = error.itemCode;
    }

    const result: any = {
      title: error.constructor.name.replace(/Error$/, '').replace(/([A-Z])/g, ' $1').trim(),
      message: error.message,
      priority,
      category
    };
    
    if (itemCode !== undefined) {
      result.itemCode = itemCode;
    }
    
    return result;
  }
}