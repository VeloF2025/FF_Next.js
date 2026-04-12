/**
 * Seasonal Analyzer
 * Seasonal pattern analysis and peak period identification for stock errors
 */

import { StockError } from '../inventory';

/** Seasonal pattern data returned by identifySeasonalPatterns */
interface SeasonalPatterns {
  hourlyPatterns: Array<{ hour: number; averageErrors: number }>;
  dailyPatterns: Array<{ dayOfWeek: number; averageErrors: number }>;
  monthlyPatterns: Array<{ month: number; averageErrors: number }>;
}

/** A single identified peak period with its likelihood score */
interface PeakPeriod {
  period: string;
  likelihood: number;
}

/**
 * Seasonal analysis functionality
 */
export class SeasonalAnalyzer {
  /**
   * Identify seasonal patterns
   */
  static identifySeasonalPatterns(errors: StockError[]): {
    hourlyPatterns: Array<{ hour: number; averageErrors: number }>;
    dailyPatterns: Array<{ dayOfWeek: number; averageErrors: number }>;
    monthlyPatterns: Array<{ month: number; averageErrors: number }>;
  } {
    const hourlyMap = new Map<number, number[]>();
    const dailyMap = new Map<number, number[]>();
    const monthlyMap = new Map<number, number[]>();

    errors.forEach(_error => {
      // For demo purposes, we'll use current time
      // In practice, you'd extract timestamp from error
      const timestamp = new Date();
      
      const hour = timestamp.getHours();
      const dayOfWeek = timestamp.getDay();
      const month = timestamp.getMonth();

      // Track patterns
      if (!hourlyMap.has(hour)) hourlyMap.set(hour, []);
      hourlyMap.get(hour)!.push(1);

      if (!dailyMap.has(dayOfWeek)) dailyMap.set(dayOfWeek, []);
      dailyMap.get(dayOfWeek)!.push(1);

      if (!monthlyMap.has(month)) monthlyMap.set(month, []);
      monthlyMap.get(month)!.push(1);
    });

    return {
      hourlyPatterns: Array.from(hourlyMap.entries())
        .map(([hour, counts]) => ({
          hour,
          averageErrors: counts.reduce((sum, count) => sum + count, 0) / counts.length
        }))
        .sort((a, b) => a.hour - b.hour),

      dailyPatterns: Array.from(dailyMap.entries())
        .map(([dayOfWeek, counts]) => ({
          dayOfWeek,
          averageErrors: counts.reduce((sum, count) => sum + count, 0) / counts.length
        }))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek),

      monthlyPatterns: Array.from(monthlyMap.entries())
        .map(([month, counts]) => ({
          month,
          averageErrors: counts.reduce((sum, count) => sum + count, 0) / counts.length
        }))
        .sort((a, b) => a.month - b.month)
    };
  }

  /**
   * Predict seasonal variations
   */
  static predictSeasonalVariations(
    historicalErrors: StockError[]
  ): {
    expectedPeakPeriods: Array<{ period: string; likelihood: number }>;
    seasonalFactors: Record<string, number>;
    adjustmentRecommendations: string[];
  } {
    const seasonalPatterns = this.identifySeasonalPatterns(historicalErrors);
    
    // Identify expected peak periods
    const expectedPeakPeriods = this.identifyPeakPeriods(seasonalPatterns);
    
    // Calculate seasonal factors
    const seasonalFactors = this.calculateSeasonalFactors(seasonalPatterns);
    
    // Generate adjustment recommendations
    const adjustmentRecommendations = this.generateSeasonalRecommendations(expectedPeakPeriods, seasonalFactors);

    return {
      expectedPeakPeriods,
      seasonalFactors,
      adjustmentRecommendations
    };
  }

  /**
   * Analyze seasonal impact on different error types
   */
  static analyzeSeasonalImpact(errors: StockError[]): {
    errorTypesByTime: Record<string, Array<{ period: string; count: number }>>;
    seasonalVariability: Record<string, number>;
    mostSeasonalErrorTypes: Array<{ type: string; variability: number }>;
  } {
    const errorTypesByTime: Record<string, Array<{ period: string; count: number }>> = {};
    const errorTypeCounts = new Map<string, Map<string, number>>();

    errors.forEach(_error => {
      const errorType = _error.constructor.name;
      const timestamp = new Date();
      const period = `${timestamp.getMonth() + 1}-${timestamp.getDate()}`; // Month-day format

      if (!errorTypeCounts.has(errorType)) {
        errorTypeCounts.set(errorType, new Map());
      }
      
      const typeCounts = errorTypeCounts.get(errorType)!;
      typeCounts.set(period, (typeCounts.get(period) || 0) + 1);
    });

    // Convert to output format and calculate variability
    const seasonalVariability: Record<string, number> = {};
    errorTypeCounts.forEach((periodCounts, errorType) => {
      const counts = Array.from(periodCounts.values());
      const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
      const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
      const standardDeviation = Math.sqrt(variance);
      
      seasonalVariability[errorType] = mean > 0 ? standardDeviation / mean : 0; // Coefficient of variation
      
      errorTypesByTime[errorType] = Array.from(periodCounts.entries())
        .map(([period, count]) => ({ period, count }))
        .sort((a, b) => a.period.localeCompare(b.period));
    });

    // Identify most seasonal error types
    const mostSeasonalErrorTypes = Object.entries(seasonalVariability)
      .map(([type, variability]) => ({ type, variability }))
      .sort((a, b) => b.variability - a.variability)
      .slice(0, 5);

    return {
      errorTypesByTime,
      seasonalVariability,
      mostSeasonalErrorTypes
    };
  }

  /**
   * Generate seasonal forecast adjustments
   */
  static generateSeasonalAdjustments(
    baselineErrors: StockError[],
    targetPeriods: string[]
  ): Array<{
    period: string;
    adjustmentFactor: number;
    expectedChange: number;
    confidence: number;
  }> {
    const seasonalPatterns = this.identifySeasonalPatterns(baselineErrors);
    // const overallAverage = baselineErrors.length / 365; // Daily average

    return targetPeriods.map(period => {
      // Simple seasonal adjustment based on historical patterns
      let adjustmentFactor = 1.0;
      let confidence = 0.5;
      
      // Check if this period historically has higher/lower error rates
      if (period.includes('Hour')) {
        const hour = parseInt(period.replace('Hour ', ''));
        const hourPattern = seasonalPatterns.hourlyPatterns.find(p => p.hour === hour);
        if (hourPattern) {
          const avgHourlyErrors = seasonalPatterns.hourlyPatterns.reduce((sum, p) => sum + p.averageErrors, 0) / seasonalPatterns.hourlyPatterns.length;
          adjustmentFactor = hourPattern.averageErrors / avgHourlyErrors;
          confidence = 0.7; // Higher confidence for hourly patterns
        }
      }

      const expectedChange = (adjustmentFactor - 1) * 100; // Percentage change

      return {
        period,
        adjustmentFactor: Math.round(adjustmentFactor * 100) / 100,
        expectedChange: Math.round(expectedChange),
        confidence: Math.round(confidence * 100) / 100
      };
    });
  }

  /**
   * Identify peak periods from seasonal patterns
   */
  private static identifyPeakPeriods(seasonalPatterns: SeasonalPatterns): PeakPeriod[] {
    const peakPeriods: PeakPeriod[] = [];

    // Find peak hours
    if (seasonalPatterns.hourlyPatterns.length > 0) {
      const maxHourlyErrors = Math.max(...seasonalPatterns.hourlyPatterns.map(p => p.averageErrors));
      if (maxHourlyErrors > 0) {
        seasonalPatterns.hourlyPatterns.forEach(pattern => {
          if (pattern.averageErrors > maxHourlyErrors * 0.8) {
            peakPeriods.push({
              period: `Hour ${pattern.hour}`,
              likelihood: pattern.averageErrors / maxHourlyErrors
            });
          }
        });
      }
    }

    // Find peak days
    if (seasonalPatterns.dailyPatterns.length > 0) {
      const maxDailyErrors = Math.max(...seasonalPatterns.dailyPatterns.map(p => p.averageErrors));
      if (maxDailyErrors > 0) {
        seasonalPatterns.dailyPatterns.forEach(pattern => {
          if (pattern.averageErrors > maxDailyErrors * 0.9) {
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            peakPeriods.push({
              period: dayNames[pattern.dayOfWeek] ?? 'Unknown',
              likelihood: pattern.averageErrors / maxDailyErrors
            });
          }
        });
      }
    }

    return peakPeriods.sort((a, b) => b.likelihood - a.likelihood);
  }

  /**
   * Calculate seasonal factors
   */
  private static calculateSeasonalFactors(seasonalPatterns: SeasonalPatterns): Record<string, number> {
    const factors: Record<string, number> = {};

    if (seasonalPatterns.hourlyPatterns.length > 0) {
      const avgHourlyErrors = seasonalPatterns.hourlyPatterns.reduce((sum: number, p) => sum + p.averageErrors, 0) / seasonalPatterns.hourlyPatterns.length;

      seasonalPatterns.hourlyPatterns.forEach(pattern => {
        factors[`hour_${pattern.hour}`] = avgHourlyErrors > 0 ? pattern.averageErrors / avgHourlyErrors : 1;
      });
    }

    if (seasonalPatterns.dailyPatterns.length > 0) {
      const avgDailyErrors = seasonalPatterns.dailyPatterns.reduce((sum: number, p) => sum + p.averageErrors, 0) / seasonalPatterns.dailyPatterns.length;

      seasonalPatterns.dailyPatterns.forEach(pattern => {
        factors[`day_${pattern.dayOfWeek}`] = avgDailyErrors > 0 ? pattern.averageErrors / avgDailyErrors : 1;
      });
    }

    return factors;
  }

  /**
   * Generate seasonal recommendations
   */
  private static generateSeasonalRecommendations(peakPeriods: PeakPeriod[], seasonalFactors: Record<string, number>): string[] {
    const recommendations: string[] = [];
    
    if (peakPeriods.length > 0) {
      recommendations.push('Prepare additional resources during identified peak periods');
      recommendations.push('Implement proactive monitoring during high-risk times');
    }
    
    const highFactors = Object.entries(seasonalFactors).filter(([_, factor]) => factor > 1.5);
    if (highFactors.length > 0) {
      recommendations.push('Focus preventive measures on periods with high seasonal factors');
    }

    if (peakPeriods.some(p => p.likelihood > 0.9)) {
      recommendations.push('Critical: Implement emergency protocols for highest-risk periods');
    }

    // Specific recommendations based on patterns
    const hourlyPeaks = peakPeriods.filter(p => p.period.startsWith('Hour'));
    if (hourlyPeaks.length > 0) {
      recommendations.push(`Schedule additional oversight during peak hours: ${hourlyPeaks.map(p => p.period).join(', ')}`);
    }

    const dailyPeaks = peakPeriods.filter(p => !p.period.startsWith('Hour'));
    if (dailyPeaks.length > 0) {
      recommendations.push(`Increase staffing on high-risk days: ${dailyPeaks.map(p => p.period).join(', ')}`);
    }

    return recommendations;
  }
}