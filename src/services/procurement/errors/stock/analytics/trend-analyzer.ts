/**
 * Trend Analyzer
 * Trend analysis and period comparison for stock errors
 */

import { StockError } from '../inventory';
import { ErrorTrend, TimeframeConfig } from './analytics-types';

/**
 * Time-based trend analysis for stock errors
 */
export class TrendAnalyzer {
  /**
   * Analyze error trends over time
   */
  static analyzeTrends(
    errors: StockError[], 
    timeframe: TimeframeConfig,
    resolution: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'daily'
  ): ErrorTrend[] {
    const trends: ErrorTrend[] = [];
    const timeSlots = this.createTimeSlots(timeframe, resolution);

    timeSlots.forEach(slot => {
      const slotErrors = this.getErrorsInTimeSlot(errors, slot.start, slot.end);
      const errorTypes = this.analyzeErrorTypes(slotErrors);
      const peakHours = this.identifyPeakHours(slotErrors);

      trends.push({
        timeframe: slot.label,
        errorCount: slotErrors.length,
        errorTypes,
        peakHours,
        resolution
      });
    });

    return trends;
  }

  /**
   * Compare trends between different periods
   */
  static comparePeriods(
    period1Errors: StockError[],
    period2Errors: StockError[],
    period1Label = 'Period 1',
    period2Label = 'Period 2'
  ): {
    errorCountChange: number;
    errorCountChangePercentage: number;
    typeDistributionChanges: Array<{ type: string; change: number; changePercentage: number }>;
    newErrorTypes: string[];
    resolvedErrorTypes: string[];
    insights: string[];
  } {
    const period1Types = this.getErrorTypeDistribution(period1Errors);
    const period2Types = this.getErrorTypeDistribution(period2Errors);
    
    const errorCountChange = period2Errors.length - period1Errors.length;
    const errorCountChangePercentage = period1Errors.length > 0 
      ? Math.round((errorCountChange / period1Errors.length) * 100) 
      : 0;

    // Calculate type distribution changes
    const typeDistributionChanges: Array<{ type: string; change: number; changePercentage: number }> = [];
    const allTypes = new Set([...Object.keys(period1Types), ...Object.keys(period2Types)]);

    allTypes.forEach(type => {
      const period1Count = period1Types[type] || 0;
      const period2Count = period2Types[type] || 0;
      const change = period2Count - period1Count;
      const changePercentage = period1Count > 0 ? Math.round((change / period1Count) * 100) : 0;

      typeDistributionChanges.push({ type, change, changePercentage });
    });

    // Identify new and resolved error types
    const newErrorTypes = Object.keys(period2Types).filter(type => !period1Types[type]);
    const resolvedErrorTypes = Object.keys(period1Types).filter(type => !period2Types[type]);

    // Generate insights
    const insights = this.generateComparisonInsights(
      errorCountChange, 
      typeDistributionChanges,
      newErrorTypes,
      resolvedErrorTypes,
      period1Label,
      period2Label
    );

    return {
      errorCountChange,
      errorCountChangePercentage,
      typeDistributionChanges: typeDistributionChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
      newErrorTypes,
      resolvedErrorTypes,
      insights
    };
  }

  /**
   * Analyze trend velocity and acceleration
   */
  static analyzeTrendVelocity(
    trends: ErrorTrend[]
  ): {
    velocity: number; // errors per period change rate
    acceleration: number; // change in velocity
    trendDirection: 'increasing' | 'decreasing' | 'stable';
    volatility: number;
  } {
    if (trends.length < 2) {
      return { velocity: 0, acceleration: 0, trendDirection: 'stable', volatility: 0 };
    }

    const errorCounts = trends.map(t => t.errorCount);
    
    // Calculate velocity (first derivative)
    const velocities = [];
    for (let i = 1; i < errorCounts.length; i++) {
      velocities.push(errorCounts[i]! - errorCounts[i - 1]!);
    }
    
    const avgVelocity = velocities.reduce((sum, v) => sum + v, 0) / velocities.length;

    // Calculate acceleration (second derivative)
    const accelerations = [];
    for (let i = 1; i < velocities.length; i++) {
      accelerations.push(velocities[i]! - velocities[i - 1]!);
    }
    
    const avgAcceleration = accelerations.length > 0 
      ? accelerations.reduce((sum, a) => sum + a, 0) / accelerations.length 
      : 0;

    // Determine trend direction
    const trendDirection: 'increasing' | 'decreasing' | 'stable' = 
      avgVelocity > 0.5 ? 'increasing' :
      avgVelocity < -0.5 ? 'decreasing' : 'stable';

    // Calculate volatility
    const mean = errorCounts.reduce((sum, count) => sum + count, 0) / errorCounts.length;
    const variance = errorCounts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / errorCounts.length;
    const volatility = Math.sqrt(variance);

    return {
      velocity: avgVelocity,
      acceleration: avgAcceleration,
      trendDirection,
      volatility
    };
  }

  /**
   * Detect anomalies in trends
   */
  static detectAnomalies(
    trends: ErrorTrend[],
    sensitivityThreshold = 2.0 // standard deviations
  ): Array<{
    period: string;
    errorCount: number;
    expectedRange: { min: number; max: number };
    severity: 'minor' | 'moderate' | 'severe';
    type: 'spike' | 'drop';
  }> {
    const errorCounts = trends.map(t => t.errorCount);
    const mean = errorCounts.reduce((sum, count) => sum + count, 0) / errorCounts.length;
    const stdDev = Math.sqrt(
      errorCounts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / errorCounts.length
    );

    const anomalies = [];
    
    for (const trend of trends) {
      const deviation = Math.abs(trend.errorCount - mean) / stdDev;
      
      if (deviation > sensitivityThreshold) {
        const severity: 'minor' | 'moderate' | 'severe' = 
          deviation > 3 ? 'severe' :
          deviation > 2.5 ? 'moderate' : 'minor';

        anomalies.push({
          period: trend.timeframe,
          errorCount: trend.errorCount,
          expectedRange: {
            min: Math.round(mean - stdDev * sensitivityThreshold),
            max: Math.round(mean + stdDev * sensitivityThreshold)
          },
          severity,
          type: trend.errorCount > mean ? 'spike' as const : 'drop' as const
        });
      }
    }

    return anomalies.sort((a, b) => {
      const severityWeight = { severe: 3, moderate: 2, minor: 1 };
      return severityWeight[b.severity] - severityWeight[a.severity];
    });
  }

  /**
   * Calculate trend correlation with external factors
   */
  static calculateCorrelations(
    trends: ErrorTrend[],
    externalFactors: Record<string, number[]>
  ): Record<string, { correlation: number; strength: 'weak' | 'moderate' | 'strong' }> {
    const errorCounts = trends.map(t => t.errorCount);
    const correlations: Record<string, { correlation: number; strength: 'weak' | 'moderate' | 'strong' }> = {};

    Object.entries(externalFactors).forEach(([factorName, factorValues]) => {
      if (factorValues.length !== errorCounts.length) return;

      const correlation = this.calculatePearsonCorrelation(errorCounts, factorValues);
      const absCorrelation = Math.abs(correlation);
      
      const strength: 'weak' | 'moderate' | 'strong' = 
        absCorrelation > 0.7 ? 'strong' :
        absCorrelation > 0.4 ? 'moderate' : 'weak';

      correlations[factorName] = { correlation, strength };
    });

    return correlations;
  }

  /**
   * Create time slots for analysis
   */
  private static createTimeSlots(
    timeframe: TimeframeConfig, 
    resolution: 'hourly' | 'daily' | 'weekly' | 'monthly'
  ): Array<{ start: Date; end: Date; label: string }> {
    const slots: Array<{ start: Date; end: Date; label: string }> = [];
    const current = new Date(timeframe.start);
    
    while (current < timeframe.end) {
      const slotEnd = new Date(current);
      let label = '';
      
      switch (resolution) {
        case 'hourly':
          slotEnd.setHours(current.getHours() + 1);
          label = `${current.toISOString().split('T')[0]} ${current.getHours()}:00`;
          break;
        case 'daily':
          slotEnd.setDate(current.getDate() + 1);
          label = current.toISOString().split('T')[0]!;
          break;
        case 'weekly':
          slotEnd.setDate(current.getDate() + 7);
          label = `Week of ${current.toISOString().split('T')[0]}`;
          break;
        case 'monthly':
          slotEnd.setMonth(current.getMonth() + 1);
          label = `${current.getFullYear()}-${(current.getMonth() + 1).toString().padStart(2, '0')}`;
          break;
      }
      
      slots.push({ 
        start: new Date(current), 
        end: new Date(Math.min(slotEnd.getTime(), timeframe.end.getTime())), 
        label 
      });
      current.setTime(slotEnd.getTime());
    }
    
    return slots;
  }

  /**
   * Get errors within a specific time slot
   */
  private static getErrorsInTimeSlot(errors: StockError[], start: Date, end: Date): StockError[] {
    // In practice, you'd filter based on error timestamp
    // For demo, we'll return a subset based on hash of time slot
    const slotHash = (start.getTime() + end.getTime()) % errors.length;
    return errors.slice(0, Math.max(1, slotHash % 10));
  }

  /**
   * Analyze error types in a collection
   */
  private static analyzeErrorTypes(errors: StockError[]): Record<string, number> {
    const types: Record<string, number> = {};
    errors.forEach(error => {
      const type = error.constructor.name;
      types[type] = (types[type] || 0) + 1;
    });
    return types;
  }

  /**
   * Identify peak hours from error data
   */
  private static identifyPeakHours(errors: StockError[]): number[] {
    const hourCounts = new Map<number, number>();
    
    errors.forEach(_error => {
      // In practice, extract from error timestamp
      const hour = new Date().getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });

    const maxCount = Math.max(...Array.from(hourCounts.values()));
    return Array.from(hourCounts.entries())
      .filter(([_, count]) => count === maxCount)
      .map(([hour, _]) => hour);
  }

  /**
   * Get error type distribution
   */
  private static getErrorTypeDistribution(errors: StockError[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    errors.forEach(error => {
      const type = error.constructor.name;
      distribution[type] = (distribution[type] || 0) + 1;
    });
    return distribution;
  }

  /**
   * Generate comparison insights
   */
  private static generateComparisonInsights(
    errorCountChange: number,
    typeDistributionChanges: Array<{ type: string; change: number; changePercentage: number }>,
    newErrorTypes: string[],
    resolvedErrorTypes: string[],
    period1Label: string,
    period2Label: string
  ): string[] {
    const insights: string[] = [];
    
    if (errorCountChange > 0) {
      insights.push(`Error count increased by ${errorCountChange} between ${period1Label} and ${period2Label}`);
    } else if (errorCountChange < 0) {
      insights.push(`Error count decreased by ${Math.abs(errorCountChange)} between ${period1Label} and ${period2Label}`);
    }
    
    if (newErrorTypes.length > 0) {
      insights.push(`New error types emerged: ${newErrorTypes.join(', ')}`);
    }
    
    if (resolvedErrorTypes.length > 0) {
      insights.push(`Error types resolved: ${resolvedErrorTypes.join(', ')}`);
    }
    
    const significantChanges = typeDistributionChanges.filter(change => Math.abs(change.changePercentage) > 20);
    if (significantChanges.length > 0) {
      insights.push(`Significant changes in error types: ${significantChanges.map(c => `${c.type} (${c.changePercentage}%)`).join(', ')}`);
    }
    
    return insights;
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private static calculatePearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n !== y.length || n === 0) return 0;

    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;

    const numerator = x.reduce((sum, val, i) => sum + (val - meanX) * (y[i]! - meanY), 0);
    const denomX = Math.sqrt(x.reduce((sum, val) => sum + Math.pow(val - meanX, 2), 0));
    const denomY = Math.sqrt(y.reduce((sum, val) => sum + Math.pow(val - meanY, 2), 0));

    if (denomX === 0 || denomY === 0) return 0;
    return numerator / (denomX * denomY);
  }
}