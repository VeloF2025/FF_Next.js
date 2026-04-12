/**
 * Analytics Engine
 * Core analytics processing and predictive insights for stock errors
 */

import { StockError } from '../inventory';
import {
  PredictiveInsights,
  ErrorAnalysisResult
} from './analytics-types';
import { ErrorTracker } from './error-tracker';

/**
 * Core analytics engine for processing stock error data and generating predictive insights
 */
export class AnalyticsEngine {
  /**
   * Generate predictive insights
   */
  static generatePredictiveInsights(errors: StockError[]): PredictiveInsights {
    const analysis = ErrorTracker.analyzeErrorPattern(errors);
    
    // Calculate risk scores for items
    const riskItems = analysis.mostCommonItems.map(item => {
      let riskScore = item.count * 10; // Base score from error frequency
      
      // Increase score for critical error types
      if (item.errorTypes.includes('InsufficientStockError')) {
        riskScore += 20;
      }
      if (item.errorTypes.includes('StockAdjustmentError')) {
        riskScore += 15;
      }
      
      // Multiple error types increase risk
      riskScore += item.errorTypes.length * 5;
      
      const predictedIssues = [];
      if (item.errorTypes.includes('InsufficientStockError')) {
        predictedIssues.push('Future stock outages likely');
      }
      if (item.errorTypes.length > 2) {
        predictedIssues.push('Complex inventory management issues');
      }
      
      return {
        itemCode: item.itemCode,
        riskScore: Math.min(100, riskScore), // Cap at 100
        predictedIssues
      };
    }).slice(0, 10);

    // Calculate risk scores for locations
    const riskLocations = analysis.locations.map(location => {
      let riskScore = location.count * 15; // Base score from error frequency
      
      // Multiple error types at same location is concerning
      riskScore += location.errorTypes.length * 10;
      
      const predictedIssues = [];
      if (location.errorTypes.length > 2) {
        predictedIssues.push('Systemic process issues');
      }
      if (location.count > 5) {
        predictedIssues.push('High likelihood of continued errors');
      }
      
      return {
        location: location.location,
        riskScore: Math.min(100, riskScore), // Cap at 100
        predictedIssues
      };
    }).slice(0, 5);

    // Generate preventive actions
    const preventiveActions = this.generatePreventiveActions();

    return {
      riskItems: riskItems.sort((a, b) => b.riskScore - a.riskScore),
      riskLocations: riskLocations.sort((a, b) => b.riskScore - a.riskScore),
      preventiveActions
    };
  }

  /**
   * Analyze risk factors across all dimensions
   */
  static analyzeRiskFactors(errors: StockError[]): {
    itemRiskFactors: Array<{ factor: string; impact: number; description: string }>;
    locationRiskFactors: Array<{ factor: string; impact: number; description: string }>;
    processRiskFactors: Array<{ factor: string; impact: number; description: string }>;
    overallRiskLevel: 'low' | 'moderate' | 'high' | 'critical';
  } {
    const analysis = ErrorTracker.analyzeErrorPattern(errors);
    
    // Analyze item risk factors
    const itemRiskFactors = this.analyzeItemRiskFactors(analysis);
    
    // Analyze location risk factors
    const locationRiskFactors = this.analyzeLocationRiskFactors(analysis);
    
    // Analyze process risk factors
    const processRiskFactors = this.analyzeProcessRiskFactors(errors);
    
    // Calculate overall risk level
    const overallRiskLevel = this.calculateOverallRiskLevel(errors, analysis);

    return {
      itemRiskFactors,
      locationRiskFactors,
      processRiskFactors,
      overallRiskLevel
    };
  }

  /**
   * Generate optimization recommendations
   */
  static generateOptimizationRecommendations(errors: StockError[]): {
    immediate: Array<{ action: string; priority: number; effort: 'low' | 'medium' | 'high' }>;
    shortTerm: Array<{ action: string; timeline: string; expectedImpact: string }>;
    longTerm: Array<{ action: string; timeline: string; expectedImpact: string }>;
  } {
    const analysis = ErrorTracker.analyzeErrorPattern(errors);

    const immediate = this.generateImmediateActions(analysis);
    const shortTerm = this.generateShortTermActions(analysis);
    const longTerm = this.generateLongTermActions(analysis);

    return { immediate, shortTerm, longTerm };
  }

  /**
   * Calculate predictive accuracy metrics
   */
  static calculatePredictiveAccuracy(
    historicalPredictions: Array<{ predicted: number; actual: number; period: string }>,
    currentPredictions: Array<{ prediction: number; confidence: number }>
  ): {
    historicalAccuracy: number;
    meanAbsoluteError: number;
    confidenceScore: number;
    reliabilityIndex: number;
  } {
    if (historicalPredictions.length === 0) {
      return {
        historicalAccuracy: 0,
        meanAbsoluteError: 0,
        confidenceScore: 0,
        reliabilityIndex: 0
      };
    }

    // Calculate historical accuracy
    const accuracyScores = historicalPredictions.map(pred => {
      const error = Math.abs(pred.predicted - pred.actual);
      const accuracy = Math.max(0, 1 - (error / Math.max(pred.actual, 1)));
      return accuracy;
    });
    
    const historicalAccuracy = accuracyScores.reduce((sum, acc) => sum + acc, 0) / accuracyScores.length;

    // Calculate mean absolute error
    const absoluteErrors = historicalPredictions.map(pred => Math.abs(pred.predicted - pred.actual));
    const meanAbsoluteError = absoluteErrors.reduce((sum, err) => sum + err, 0) / absoluteErrors.length;

    // Calculate confidence score from current predictions
    const confidenceScore = currentPredictions.length > 0
      ? currentPredictions.reduce((sum, pred) => sum + pred.confidence, 0) / currentPredictions.length
      : 0;

    // Calculate reliability index (combination of accuracy and consistency)
    const errorVariance = this.calculateVariance(absoluteErrors);
    const consistencyScore = 1 / (1 + errorVariance);
    const reliabilityIndex = (historicalAccuracy + consistencyScore) / 2;

    return {
      historicalAccuracy: Math.round(historicalAccuracy * 100) / 100,
      meanAbsoluteError: Math.round(meanAbsoluteError * 100) / 100,
      confidenceScore: Math.round(confidenceScore * 100) / 100,
      reliabilityIndex: Math.round(reliabilityIndex * 100) / 100
    };
  }

  /**
   * Generate preventive actions
   */
  private static generatePreventiveActions() {
    return [
      {
        priority: 1,
        action: 'Implement automated reorder points for top 10 problematic items',
        expectedImpact: 'Reduce insufficient stock errors by 60-80%'
      },
      {
        priority: 2,
        action: 'Conduct process audit for locations with highest error rates',
        expectedImpact: 'Reduce location-specific errors by 40-60%'
      },
      {
        priority: 3,
        action: 'Implement real-time inventory tracking and alerts',
        expectedImpact: 'Improve error detection and response time by 70%'
      },
      {
        priority: 4,
        action: 'Enhance staff training on inventory management procedures',
        expectedImpact: 'Reduce human error-related issues by 30-50%'
      }
    ];
  }

  /**
   * Analyze item risk factors
   */
  private static analyzeItemRiskFactors(analysis: ErrorAnalysisResult): Array<{ factor: string; impact: number; description: string }> {
    const factors = [];

    if (analysis.mostCommonItems.length > 0) {
      const topItem = analysis.mostCommonItems[0]!;
      factors.push({
        factor: 'High-frequency item errors',
        impact: topItem.count,
        description: `Item ${topItem.itemCode} has ${topItem.count} errors`
      });
    }

    // Check for items with multiple error types
    const complexItems = analysis.mostCommonItems.filter((item: { itemCode: string; count: number; errorTypes: string[] }) => item.errorTypes.length > 2);
    if (complexItems.length > 0) {
      factors.push({
        factor: 'Complex item error patterns',
        impact: complexItems.length,
        description: `${complexItems.length} items have multiple error types`
      });
    }

    return factors;
  }

  /**
   * Analyze location risk factors
   */
  private static analyzeLocationRiskFactors(analysis: ErrorAnalysisResult): Array<{ factor: string; impact: number; description: string }> {
    const factors = [];

    if (analysis.locations.length > 0) {
      const topLocation = analysis.locations[0]!;
      factors.push({
        factor: 'High-error location',
        impact: topLocation.count,
        description: `Location ${topLocation.location} has ${topLocation.count} errors`
      });
    }

    return factors;
  }

  /**
   * Analyze process risk factors
   */
  private static analyzeProcessRiskFactors(errors: StockError[]): Array<{ factor: string; impact: number; description: string }> {
    const factors = [];
    const errorTypes = new Map<string, number>();

    errors.forEach(error => {
      const type = error.constructor.name;
      errorTypes.set(type, (errorTypes.get(type) || 0) + 1);
    });

    const totalErrors = errors.length;
    const insufficientStock = errorTypes.get('InsufficientStockError') || 0;
    
    if (insufficientStock > totalErrors * 0.5) {
      factors.push({
        factor: 'Inventory management issues',
        impact: insufficientStock,
        description: 'High proportion of insufficient stock errors indicates inventory management problems'
      });
    }

    return factors;
  }

  /**
   * Calculate overall risk level
   */
  private static calculateOverallRiskLevel(errors: StockError[], analysis: ErrorAnalysisResult): 'low' | 'moderate' | 'high' | 'critical' {
    let riskScore = 0;

    // Factor in error count
    riskScore += errors.length * 0.1;

    // Factor in item concentration
    if (analysis.mostCommonItems.length > 0) {
      const topItem = analysis.mostCommonItems[0]!;
      riskScore += topItem.count * 0.5;
    }

    // Factor in location concentration
    if (analysis.locations.length > 0) {
      const topLocation = analysis.locations[0]!;
      riskScore += topLocation.count * 0.3;
    }

    if (riskScore > 20) return 'critical';
    if (riskScore > 10) return 'high';
    if (riskScore > 5) return 'moderate';
    return 'low';
  }

  /**
   * Generate immediate actions
   */
  private static generateImmediateActions(_analysis: ErrorAnalysisResult) {
    return [
      { action: 'Review top problematic items', priority: 1, effort: 'low' as const },
      { action: 'Check stock levels for frequent shortage items', priority: 2, effort: 'low' as const },
      { action: 'Alert relevant staff about high-error locations', priority: 3, effort: 'low' as const }
    ];
  }

  /**
   * Generate short-term actions
   */
  private static generateShortTermActions(_analysis: ErrorAnalysisResult) {
    return [
      { action: 'Implement monitoring for top 10 items', timeline: '1-2 weeks', expectedImpact: 'Reduce item-specific errors by 40%' },
      { action: 'Audit high-error locations', timeline: '2-3 weeks', expectedImpact: 'Identify root causes of location issues' }
    ];
  }

  /**
   * Generate long-term actions
   */
  private static generateLongTermActions(_analysis: ErrorAnalysisResult) {
    return [
      { action: 'Implement predictive inventory system', timeline: '2-3 months', expectedImpact: 'Reduce overall errors by 60%' },
      { action: 'Redesign inventory processes', timeline: '3-6 months', expectedImpact: 'Systematic improvement in error rates' }
    ];
  }

  /**
   * Calculate variance for reliability index
   */
  private static calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    return squaredDifferences.reduce((sum, diff) => sum + diff, 0) / values.length;
  }
}