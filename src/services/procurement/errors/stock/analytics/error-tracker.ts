/**
 * Error Tracker
 * Error tracking and data collection functionality for stock errors
 */

import { StockError, InsufficientStockError, StockReservationError } from '../inventory';
import { StockMovementError, StockTransferError, StockAdjustmentError } from '../tracking';
import { 
  ErrorAnalysisResult, 
  ItemErrorData, 
  LocationErrorData 
} from './analytics-types';

/**
 * Error data collection and basic analysis
 */
export class ErrorTracker {
  /**
   * Analyze error patterns for basic insights
   */
  static analyzeErrorPattern(errors: StockError[]): ErrorAnalysisResult {
    const itemCodeCounts = new Map<string, ItemErrorData>();
    const errorTypeCounts = new Map<string, number>();
    const locationCounts = new Map<string, LocationErrorData>();
    const hourCounts = new Map<number, number>();
    const itemErrorPairs = new Map<string, Set<string>>();

    errors.forEach(error => {
      // Count by item code
      this.trackItemErrors(error, itemCodeCounts, itemErrorPairs);
      
      // Count by error type
      this.trackErrorTypes(error, errorTypeCounts);
      
      // Count by location
      this.trackLocationErrors(error, locationCounts);
      
      // Count by hour (would need actual timestamp data)
      this.trackTimeDistribution(error, hourCounts);
    });

    // Calculate correlations between items that commonly have errors together
    const correlations = this.calculateItemCorrelations(itemCodeCounts, itemErrorPairs);
    const totalErrors = errors.length;

    return {
      mostCommonItems: this.formatItemResults(itemCodeCounts),
      errorTypes: this.formatErrorTypeResults(errorTypeCounts, totalErrors),
      timeDistribution: this.formatTimeDistribution(hourCounts),
      locations: this.formatLocationResults(locationCounts),
      correlations: this.formatCorrelations(correlations)
    };
  }

  /**
   * Track errors by item code
   */
  private static trackItemErrors(
    error: StockError, 
    itemCodeCounts: Map<string, ItemErrorData>,
    itemErrorPairs: Map<string, Set<string>>
  ): void {
    if ('itemCode' in error && error.itemCode && typeof error.itemCode === 'string') {
      const itemCode = error.itemCode as string;
      const current = itemCodeCounts.get(itemCode) || { count: 0, errorTypes: new Set() };
      current.count++;
      current.errorTypes.add(error.constructor.name);
      itemCodeCounts.set(itemCode, current);

      // Track item-error type pairs for correlation analysis
      const errorType = error.constructor.name;
      if (!itemErrorPairs.has(itemCode)) {
        itemErrorPairs.set(itemCode, new Set());
      }
      itemErrorPairs.get(itemCode)!.add(errorType);
    }
  }

  /**
   * Track error types
   */
  private static trackErrorTypes(error: StockError, errorTypeCounts: Map<string, number>): void {
    const errorType = error.constructor.name;
    const currentType = errorTypeCounts.get(errorType) || 0;
    errorTypeCounts.set(errorType, currentType + 1);
  }

  /**
   * Track errors by location
   */
  private static trackLocationErrors(
    error: StockError, 
    locationCounts: Map<string, LocationErrorData>
  ): void {
    let location: string | null = null;
    if ('location' in error && error.location && typeof error.location === 'string') {
      location = error.location as string;
    } else if ('fromLocation' in error && error.fromLocation && typeof error.fromLocation === 'string') {
      location = error.fromLocation as string;
    }

    if (location) {
      const current = locationCounts.get(location) || { count: 0, errorTypes: new Set() };
      current.count++;
      current.errorTypes.add(error.constructor.name);
      locationCounts.set(location, current);
    }
  }

  /**
   * Track time distribution (basic hourly tracking)
   */
  private static trackTimeDistribution(_error: StockError, hourCounts: Map<number, number>): void {
    // Would need actual timestamp data from error
    const hour = new Date().getHours();
    const currentHour = hourCounts.get(hour) || 0;
    hourCounts.set(hour, currentHour + 1);
  }

  /**
   * Calculate correlations between items
   */
  private static calculateItemCorrelations(
    itemCodeCounts: Map<string, ItemErrorData>,
    itemErrorPairs: Map<string, Set<string>>
  ): Array<{ items: string[]; strength: number; commonErrors: string[] }> {
    const correlations: Array<{ items: string[]; strength: number; commonErrors: string[] }> = [];
    const itemCodes = Array.from(itemCodeCounts.keys());

    for (let i = 0; i < itemCodes.length - 1; i++) {
      for (let j = i + 1; j < itemCodes.length; j++) {
        const item1 = itemCodes[i];
        const item2 = itemCodes[j];
        const errors1 = itemErrorPairs.get(item1!) || new Set();
        const errors2 = itemErrorPairs.get(item2!) || new Set();

        const commonErrors = Array.from(errors1).filter(error => errors2.has(error));
        if (commonErrors.length > 0) {
          const strength = commonErrors.length / Math.max(errors1.size, errors2.size);
          correlations.push({
            items: [item1!, item2!],
            strength,
            commonErrors
          });
        }
      }
    }

    return correlations;
  }

  /**
   * Format item results
   */
  private static formatItemResults(
    itemCodeCounts: Map<string, ItemErrorData>
  ): Array<{ itemCode: string; count: number; errorTypes: string[] }> {
    return Array.from(itemCodeCounts.entries())
      .map(([itemCode, data]) => ({
        itemCode,
        count: data.count,
        errorTypes: Array.from(data.errorTypes)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Format error type results
   */
  private static formatErrorTypeResults(
    errorTypeCounts: Map<string, number>,
    totalErrors: number
  ): Array<{ type: string; count: number; percentage: number }> {
    return Array.from(errorTypeCounts.entries())
      .map(([type, count]) => ({
        type,
        count,
        percentage: Math.round((count / totalErrors) * 100)
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Format time distribution results
   */
  private static formatTimeDistribution(
    hourCounts: Map<number, number>
  ): Array<{ hour: number; count: number }> {
    return Array.from(hourCounts.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);
  }

  /**
   * Format location results
   */
  private static formatLocationResults(
    locationCounts: Map<string, LocationErrorData>
  ): Array<{ location: string; count: number; errorTypes: string[] }> {
    return Array.from(locationCounts.entries())
      .map(([location, data]) => ({
        location,
        count: data.count,
        errorTypes: Array.from(data.errorTypes)
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Format correlation results
   */
  private static formatCorrelations(
    correlations: Array<{ items: string[]; strength: number; commonErrors: string[] }>
  ): Array<{ items: string[]; strength: number; commonErrors: string[] }> {
    return correlations
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5);
  }

  /**
   * Get error categorization
   */
  static categorizeError(error: StockError): string {
    if (error instanceof InsufficientStockError) {
      return 'Inventory Shortage';
    } else if (error instanceof StockReservationError) {
      return 'Reservation Issue';
    } else if (error instanceof StockMovementError) {
      return 'Movement Error';
    } else if (error instanceof StockTransferError) {
      return 'Transfer Error';
    } else if (error instanceof StockAdjustmentError) {
      return 'Adjustment Error';
    } else {
      return 'General Stock Error';
    }
  }

  /**
   * Extract location from error
   */
  static extractErrorLocation(error: StockError): string | null {
    if ('location' in error && error.location && typeof error.location === 'string') {
      return error.location as string;
    } else if ('fromLocation' in error && error.fromLocation && typeof error.fromLocation === 'string') {
      return error.fromLocation as string;
    } else if ('toLocation' in error && error.toLocation && typeof error.toLocation === 'string') {
      return error.toLocation as string;
    }
    return null;
  }

  /**
   * Extract item code from error
   */
  static extractItemCode(error: StockError): string | null {
    if ('itemCode' in error && error.itemCode && typeof error.itemCode === 'string') {
      return error.itemCode as string;
    }
    return null;
  }
}