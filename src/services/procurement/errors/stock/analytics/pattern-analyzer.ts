/**
 * Pattern Analyzer
 * Pattern identification and analysis for stock errors
 */

import { StockError } from '../inventory';
import { ErrorPattern, ErrorInsight } from './analytics-types';
import { ErrorTracker } from './error-tracker';

/**
 * Pattern analysis for stock errors
 */
export class PatternAnalyzer {
  /**
   * Identify error patterns and trends
   */
  static identifyErrorPatterns(errors: StockError[]): ErrorPattern[] {
    const patterns: ErrorPattern[] = [];
    const analysis = ErrorTracker.analyzeErrorPattern(errors);

    // Pattern: Frequent insufficient stock for specific items
    const frequentInsufficientStock = analysis.mostCommonItems
      .filter(item => item.errorTypes.includes('InsufficientStockError') && item.count >= 3)
      .map(item => ({
        pattern: `Frequent stock shortages for ${item.itemCode}`,
        frequency: item.count,
        severity: item.count > 5 ? 8 : item.count > 3 ? 6 : 4,
        affectedItems: [item.itemCode],
        affectedLocations: [],
        recommendedActions: [
          'Review reorder points and safety stock levels',
          'Implement automatic reordering',
          'Analyze demand patterns for better forecasting'
        ]
      }));

    patterns.push(...frequentInsufficientStock);

    // Pattern: High error rate for specific locations
    const problematicLocations = analysis.locations
      .filter(location => location.count >= 3)
      .map(location => ({
        pattern: `High error rate at location ${location.location}`,
        frequency: location.count,
        severity: location.count > 5 ? 7 : 5,
        affectedItems: [],
        affectedLocations: [location.location],
        recommendedActions: [
          'Audit location processes and equipment',
          'Review staff training for this location',
          'Check physical layout and organization'
        ]
      }));

    patterns.push(...problematicLocations);

    // Pattern: Correlated item errors
    analysis.correlations
      .filter(correlation => correlation.strength > 0.7)
      .forEach(correlation => {
        patterns.push({
          pattern: `Correlated errors between items: ${correlation.items.join(', ')}`,
          frequency: correlation.commonErrors.length,
          severity: 6,
          affectedItems: correlation.items,
          affectedLocations: [],
          recommendedActions: [
            'Investigate supply chain dependencies',
            'Review storage or handling procedures',
            'Check for common supplier or process issues'
          ]
        });
      });

    return patterns.sort((a, b) => b.severity - a.severity);
  }

  /**
   * Generate error insights and recommendations
   */
  static generateErrorInsights(errors: StockError[]): ErrorInsight[] {
    const insights: ErrorInsight[] = [];
    const analysis = ErrorTracker.analyzeErrorPattern(errors);

    // Insight: Most problematic items
    if (analysis.mostCommonItems.length > 0) {
      const topItem = analysis.mostCommonItems[0]!;
      insights.push({
        type: 'item',
        title: `Item ${topItem.itemCode} has the highest error rate`,
        description: `${topItem.itemCode} accounts for ${topItem.count} errors (${Math.round((topItem.count / errors.length) * 100)}% of total errors)`,
        impact: topItem.count > 10 ? 'high' : topItem.count > 5 ? 'medium' : 'low',
        actionable: true,
        recommendations: [
          'Review inventory management parameters',
          'Implement demand forecasting improvements',
          'Consider alternative suppliers or products'
        ],
        data: {
          itemCode: topItem.itemCode,
          errorCount: topItem.count,
          errorTypes: topItem.errorTypes
        }
      });
    }

    // Insight: Error type distribution
    const insufficientStockErrors = analysis.errorTypes.find(t => t.type === 'InsufficientStockError');
    if (insufficientStockErrors && insufficientStockErrors.percentage > 50) {
      insights.push({
        type: 'process',
        title: 'Insufficient stock is the primary issue',
        description: `${insufficientStockErrors.percentage}% of errors are due to insufficient stock`,
        impact: 'high',
        actionable: true,
        recommendations: [
          'Implement automated reorder points',
          'Improve demand forecasting accuracy',
          'Review safety stock levels across all items'
        ],
        data: {
          percentage: insufficientStockErrors.percentage,
          count: insufficientStockErrors.count
        }
      });
    }

    // Insight: Location concentration
    const topLocation = analysis.locations[0];
    if (topLocation && topLocation.count > errors.length * 0.3) {
      insights.push({
        type: 'location',
        title: `Location ${topLocation.location} has disproportionate error rate`,
        description: `${topLocation.location} accounts for ${Math.round((topLocation.count / errors.length) * 100)}% of errors`,
        impact: 'medium',
        actionable: true,
        recommendations: [
          'Conduct location-specific process audit',
          'Review staff training and procedures',
          'Check equipment and infrastructure'
        ],
        data: {
          location: topLocation.location,
          errorCount: topLocation.count,
          errorTypes: topLocation.errorTypes
        }
      });
    }

    // Insight: Time-based patterns
    if (analysis.timeDistribution.length > 0) {
      const peakHour = analysis.timeDistribution.reduce((max, current) => 
        current.count > max.count ? current : max
      );
      
      if (peakHour.count > errors.length * 0.2) {
        insights.push({
          type: 'timing',
          title: `Error spike at hour ${peakHour.hour}`,
          description: `${Math.round((peakHour.count / errors.length) * 100)}% of errors occur around hour ${peakHour.hour}`,
          impact: 'medium',
          actionable: true,
          recommendations: [
            'Analyze workload distribution during peak hours',
            'Consider staff scheduling adjustments',
            'Implement additional quality checks during high-risk periods'
          ],
          data: {
            peakHour: peakHour.hour,
            errorCount: peakHour.count
          }
        });
      }
    }

    return insights.sort((a, b) => {
      const impactWeight = { high: 3, medium: 2, low: 1 };
      return impactWeight[b.impact] - impactWeight[a.impact];
    });
  }

  /**
   * Analyze specific pattern types
   */
  static analyzeItemPatterns(errors: StockError[]): {
    highFrequencyItems: string[];
    criticalItems: string[];
    correlatedItems: Array<{ items: string[]; correlation: number }>;
  } {
    const analysis = ErrorTracker.analyzeErrorPattern(errors);

    const highFrequencyItems = analysis.mostCommonItems
      .filter(item => item.count > 5)
      .map(item => item.itemCode);

    const criticalItems = analysis.mostCommonItems
      .filter(item => item.errorTypes.includes('InsufficientStockError') && item.count > 3)
      .map(item => item.itemCode);

    const correlatedItems = analysis.correlations
      .filter(correlation => correlation.strength > 0.6)
      .map(correlation => ({
        items: correlation.items,
        correlation: correlation.strength
      }));

    return {
      highFrequencyItems,
      criticalItems,
      correlatedItems
    };
  }

  /**
   * Analyze location patterns
   */
  static analyzeLocationPatterns(errors: StockError[]): {
    problematicLocations: string[];
    locationErrorDistribution: Record<string, string[]>;
    locationRiskScores: Array<{ location: string; riskScore: number }>;
  } {
    const analysis = ErrorTracker.analyzeErrorPattern(errors);

    const problematicLocations = analysis.locations
      .filter(location => location.count > 3)
      .map(location => location.location);

    const locationErrorDistribution: Record<string, string[]> = {};
    analysis.locations.forEach(location => {
      locationErrorDistribution[location.location] = location.errorTypes;
    });

    const locationRiskScores = analysis.locations.map(location => ({
      location: location.location,
      riskScore: location.count * 10 + location.errorTypes.length * 5
    }));

    return {
      problematicLocations,
      locationErrorDistribution,
      locationRiskScores
    };
  }

  /**
   * Analyze timing patterns
   */
  static analyzeTimingPatterns(errors: StockError[]): {
    peakHours: number[];
    averageErrorsPerHour: number;
    hourlyDistribution: Array<{ hour: number; count: number; percentage: number }>;
  } {
    const analysis = ErrorTracker.analyzeErrorPattern(errors);
    const totalErrors = errors.length;

    const peakHours = analysis.timeDistribution
      .filter(hour => hour.count > totalErrors * 0.1)
      .map(hour => hour.hour);

    const averageErrorsPerHour = totalErrors / 24;

    const hourlyDistribution = analysis.timeDistribution.map(hour => ({
      hour: hour.hour,
      count: hour.count,
      percentage: Math.round((hour.count / totalErrors) * 100)
    }));

    return {
      peakHours,
      averageErrorsPerHour,
      hourlyDistribution
    };
  }
}