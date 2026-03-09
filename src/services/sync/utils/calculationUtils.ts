/**
 * Calculation Utilities
 * Mathematical calculation functions for sync operations
 */

/**
 * Mathematical calculation utilities
 */
export class CalculationUtils {
  /**
   * Calculate completion percentage
   */
  static calculateCompletionPercentage(completed: number, total: number): number {
    if (total <= 0) return 0;
    const percentage = (completed / total) * 100;
    return Math.min(100, Math.max(0, percentage));
  }

  /**
   * Calculate weighted average
   */
  static calculateWeightedAverage(values: Array<{ value: number; weight: number }>): number {
    if (values.length === 0) return 0;
    
    const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight === 0) return 0;
    
    const weightedSum = values.reduce((sum, item) => sum + (item.value * item.weight), 0);
    return weightedSum / totalWeight;
  }

  /**
   * Calculate standard deviation
   */
  static calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Calculate median value
   */
  static calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1]! + sorted[middle]!) / 2;
    }

    return sorted[middle]!;
  }

  /**
   * Calculate percentile
   */
  static calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    if (percentile < 0 || percentile > 100) throw new Error('Percentile must be between 0 and 100');
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    
    if (Number.isInteger(index)) {
      return sorted[index]!;
    }

    const lower = sorted[Math.floor(index)]!;
    const upper = sorted[Math.ceil(index)]!;
    const weight = index - Math.floor(index);

    return lower + (upper - lower) * weight;
  }

  /**
   * Calculate growth rate between two values
   */
  static calculateGrowthRate(oldValue: number, newValue: number): number {
    if (oldValue === 0) return newValue > 0 ? 100 : 0;
    
    return ((newValue - oldValue) / oldValue) * 100;
  }

  /**
   * Calculate compound annual growth rate (CAGR)
   */
  static calculateCAGR(beginningValue: number, endingValue: number, periods: number): number {
    if (beginningValue <= 0 || endingValue <= 0 || periods <= 0) return 0;
    
    return (Math.pow(endingValue / beginningValue, 1 / periods) - 1) * 100;
  }

  /**
   * Calculate moving average
   */
  static calculateMovingAverage(values: number[], window: number): number[] {
    if (values.length === 0 || window <= 0) return [];
    
    const result: number[] = [];
    
    for (let i = window - 1; i < values.length; i++) {
      const slice = values.slice(i - window + 1, i + 1);
      const average = slice.reduce((sum, value) => sum + value, 0) / slice.length;
      result.push(average);
    }
    
    return result;
  }

  /**
   * Calculate exponential moving average
   */
  static calculateEMA(values: number[], alpha: number = 0.1): number[] {
    if (values.length === 0) return [];
    
    const result: number[] = [values[0]!];

    for (let i = 1; i < values.length; i++) {
      const ema = alpha * values[i]! + (1 - alpha) * result[i - 1]!;
      result.push(ema);
    }
    
    return result;
  }

  /**
   * Calculate correlation coefficient between two datasets
   */
  static calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;
    
    const n = x.length;
    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;
    
    let numerator = 0;
    let denominatorX = 0;
    let denominatorY = 0;
    
    for (let i = 0; i < n; i++) {
      const diffX = x[i]! - meanX;
      const diffY = y[i]! - meanY;

      numerator += diffX * diffY;
      denominatorX += diffX * diffX;
      denominatorY += diffY * diffY;
    }
    
    const denominator = Math.sqrt(denominatorX * denominatorY);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Calculate linear regression slope and intercept
   */
  static calculateLinearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
    if (x.length !== y.length || x.length === 0) {
      return { slope: 0, intercept: 0, r2: 0 };
    }
    
    const n = x.length;
    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;
    
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < n; i++) {
      const diffX = x[i]! - meanX;
      numerator += diffX * (y[i]! - meanY);
      denominator += diffX * diffX;
    }
    
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = meanY - slope * meanX;
    
    // Calculate R-squared
    const correlation = this.calculateCorrelation(x, y);
    const r2 = correlation * correlation;
    
    return { slope, intercept, r2 };
  }

  /**
   * Round to specified decimal places
   */
  static roundToDecimals(value: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }

  /**
   * Clamp value between min and max
   */
  static clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}