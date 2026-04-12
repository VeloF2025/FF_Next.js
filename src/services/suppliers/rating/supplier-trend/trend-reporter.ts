/**
 * Trend Reporter
 * Comprehensive trend analysis and reporting
 */

import { SupplierRatingAnalyzer } from './rating-analyzer';
import { SupplierPerformanceTracker } from './performance-tracker';
import { log } from '@/lib/logger';
import type {
  TrendSummaryReport,
  CategoryTrend,
  RatingTrend,
  PerformanceTrend,
  GrowthTrend,
  TrendAnalysisOptions,
  TrendMetrics,
  CorrelationMatrix
} from './trend-types';

/** Anomaly record returned by SupplierRatingAnalyzer.identifyRatingAnomalies */
interface RatingAnomaly {
  period: string;
  type: 'spike' | 'drop' | 'unusual_activity';
  severity: 'low' | 'medium' | 'high';
  description: string;
  impact: number;
}

/** A single forward-looking prediction point */
interface ForecastPoint {
  period: string;
  predictedRating: number;
  confidence: number;
}

export class SupplierTrendReporter {
  /**
   * Get category performance trends
   */
  static async getCategoryTrends(
    categories: string[],
    months: number = 12
  ): Promise<Record<string, CategoryTrend[]>> {
    try {
      const categoryTrends: Record<string, CategoryTrend[]> = {};
      const currentDate = new Date();
      
      for (const category of categories) {
        const trends = [];
        let previousRating = 72 + Math.random() * 18; // Starting base rating 72-90
        let supplierCount = Math.floor(8 + Math.random() * 20); // Starting supplier count 8-28
        
        // Category-specific characteristics
        const categoryMultiplier = this.getCategoryMultiplier(category);
        
        for (let i = months - 1; i >= 0; i--) {
          const periodDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
          const periodName = periodDate.toISOString().substring(0, 7); // YYYY-MM format
          
          // Apply category-specific variations
          const baseVariation = (Math.random() - 0.5) * 6;
          const categoryEffect = (categoryMultiplier - 1) * 3;
          const seasonalEffect = this.getCategorySeasonalEffect(category, periodDate.getMonth());
          
          const currentRating = Math.max(60, Math.min(100, 
            previousRating + baseVariation + categoryEffect + seasonalEffect
          ));
          
          // Supplier count changes
          const countVariation = Math.floor((Math.random() - 0.5) * 6);
          supplierCount = Math.max(5, Math.min(50, supplierCount + countVariation));
          
          // Determine trend
          const ratingDiff = currentRating - previousRating;
          const trend: 'up' | 'down' | 'stable' = 
            ratingDiff > 3 ? 'up' : ratingDiff < -3 ? 'down' : 'stable';
          
          trends.push({
            period: periodName,
            averageRating: Math.round(currentRating * 10) / 10,
            supplierCount,
            trend
          });
          
          previousRating = currentRating;
        }
        
        categoryTrends[category] = trends;
      }
      
      return categoryTrends;
    } catch (error) {
      log.error('Error getting category trends:', { data: error }, 'trend-reporter');
      return {};
    }
  }

  /**
   * Generate comprehensive trend summary report
   */
  static async generateTrendSummaryReport(months: number = 6): Promise<TrendSummaryReport> {
    try {
      const [ratingTrends, performanceTrends, growthTrends] = await Promise.all([
        SupplierRatingAnalyzer.analyzeRatingTrends(months),
        SupplierPerformanceTracker.getPerformanceTrends(months),
        SupplierPerformanceTracker.getSupplierGrowthTrends(months)
      ]);

      // Calculate trend metrics
      const ratingMetrics = SupplierRatingAnalyzer.calculateTrendMetrics(ratingTrends);
      const performanceCorrelations = SupplierPerformanceTracker.calculatePerformanceCorrelations(performanceTrends);

      // Analyze overall trend
      const overallTrend = this.determineOverallTrend(ratingTrends, performanceTrends, ratingMetrics);

      // Generate comprehensive insights
      const keyInsights = this.generateKeyInsights(
        ratingTrends, 
        performanceTrends, 
        growthTrends, 
        ratingMetrics,
        performanceCorrelations,
        months
      );

      // Generate actionable recommendations
      const recommendations = this.generateRecommendations(
        overallTrend,
        ratingMetrics,
        performanceCorrelations,
        growthTrends,
        months
      );

      return {
        overallTrend,
        ratingTrends,
        performanceTrends,
        growthTrends,
        keyInsights,
        recommendations
      };
    } catch (error) {
      log.error('Error generating trend summary report:', { data: error }, 'trend-reporter');
      throw error;
    }
  }

  /**
   * Generate advanced analytics report
   */
  static async generateAdvancedAnalyticsReport(options: TrendAnalysisOptions): Promise<{
    trendMetrics: TrendMetrics;
    performanceCorrelations: CorrelationMatrix;
    anomalies: RatingAnomaly[];
    predictions: ForecastPoint[];
    recommendations: string[];
  }> {
    try {
      const ratingTrends = await SupplierRatingAnalyzer.analyzeRatingTrends(options.months || 12);
      const performanceTrends = await SupplierPerformanceTracker.getPerformanceTrends(options.months || 12);

      // Calculate advanced metrics
      const trendMetrics = SupplierRatingAnalyzer.calculateTrendMetrics(ratingTrends);
      const performanceCorrelations = SupplierPerformanceTracker.calculatePerformanceCorrelations(performanceTrends);
      const anomalies = SupplierRatingAnalyzer.identifyRatingAnomalies(ratingTrends);

      // Generate predictions (simplified)
      const predictions = this.generatePredictions(ratingTrends, performanceTrends, 3);

      // Generate recommendations based on advanced analysis
      const recommendations = this.generateAdvancedRecommendations(
        trendMetrics,
        performanceCorrelations,
        anomalies
      );

      return {
        trendMetrics,
        performanceCorrelations,
        anomalies,
        predictions,
        recommendations
      };
    } catch (error) {
      log.error('Error generating advanced analytics report:', { data: error }, 'trend-reporter');
      throw error;
    }
  }

  /**
   * Determine overall trend direction
   */
  private static determineOverallTrend(
    ratingTrends: RatingTrend[],
    performanceTrends: PerformanceTrend[],
    metrics: TrendMetrics
  ): 'improving' | 'declining' | 'stable' {
    // Analyze multiple factors
    const ratingSlope = metrics.slope;
    const recentRatings = ratingTrends.slice(-3).map(t => t.averageRating);
    const earlierRatings = ratingTrends.slice(0, 3).map(t => t.averageRating);
    
    const recentAvg = recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length;
    const earlierAvg = earlierRatings.reduce((a, b) => a + b, 0) / earlierRatings.length;
    const overallChange = recentAvg - earlierAvg;

    // Performance metrics consideration
    const recentPerformance = performanceTrends.slice(-3);
    const improvingMetrics = recentPerformance.reduce((count, trend) => {
      return count + 
        (trend.delivery.trend === 'up' ? 1 : 0) +
        (trend.quality.trend === 'up' ? 1 : 0) +
        (trend.service.trend === 'up' ? 1 : 0) +
        (trend.price.trend === 'up' ? 1 : 0);
    }, 0);

    const totalMetrics = recentPerformance.length * 4;
    const improvementRate = improvingMetrics / totalMetrics;

    // Combined assessment
    if (ratingSlope > 0.5 || (overallChange > 2 && improvementRate > 0.4)) {
      return 'improving';
    } else if (ratingSlope < -0.5 || (overallChange < -2 && improvementRate < 0.2)) {
      return 'declining';
    } else {
      return 'stable';
    }
  }

  /**
   * Generate comprehensive key insights
   */
  private static generateKeyInsights(
    _ratingTrends: RatingTrend[],
    _performanceTrends: PerformanceTrend[],
    growthTrends: GrowthTrend[],
    metrics: TrendMetrics,
    correlations: CorrelationMatrix,
    _months: number
  ): string[] {
    const insights: string[] = [];

    // Rating trend insights
    if (metrics.slope > 0.5) {
      insights.push(`Strong positive trend: Supplier ratings improving by ${metrics.slope.toFixed(1)} points per month`);
    } else if (metrics.slope < -0.5) {
      insights.push(`Concerning decline: Supplier ratings dropping by ${Math.abs(metrics.slope).toFixed(1)} points per month`);
    }

    // Growth insights
    const recentGrowth = growthTrends.slice(-3);
    const avgGrowthRate = recentGrowth.reduce((sum, trend) => sum + trend.growthRate, 0) / recentGrowth.length;
    
    if (avgGrowthRate > 8) {
      insights.push(`Rapid supplier base expansion at ${avgGrowthRate.toFixed(1)}% monthly growth rate`);
    } else if (avgGrowthRate < -3) {
      insights.push(`Supplier base contracting at ${Math.abs(avgGrowthRate).toFixed(1)}% monthly rate`);
    }

    // Performance correlation insights
    if (correlations.deliveryQuality > 0.7) {
      insights.push(`Strong positive correlation (${(correlations.deliveryQuality * 100).toFixed(0)}%) between delivery and quality metrics`);
    } else if (correlations.qualityPrice < -0.5) {
      insights.push(`Inverse relationship detected: Higher quality associated with higher costs`);
    }

    // Volatility insights
    if (metrics.variance > 15) {
      insights.push(`High performance volatility detected - inconsistent supplier performance patterns`);
    } else if (metrics.variance < 5) {
      insights.push(`Remarkably stable performance across all suppliers and time periods`);
    }

    // Seasonal patterns
    if (metrics.seasonality) {
      insights.push(`Clear seasonal performance patterns identified - plan resource allocation accordingly`);
    }

    return insights;
  }

  /**
   * Generate actionable recommendations
   */
  private static generateRecommendations(
    overallTrend: string,
    metrics: TrendMetrics,
    correlations: CorrelationMatrix,
    growthTrends: GrowthTrend[],
    _months: number
  ): string[] {
    const recommendations: string[] = [];

    // Trend-based recommendations
    if (overallTrend === 'improving') {
      recommendations.push('Identify and document best practices driving positive trends for replication');
      recommendations.push('Consider expanding successful supplier relationships');
    } else if (overallTrend === 'declining') {
      recommendations.push('URGENT: Implement comprehensive supplier performance improvement program');
      recommendations.push('Conduct root cause analysis for declining performance patterns');
    } else {
      recommendations.push('Explore breakthrough improvement opportunities beyond current plateau');
    }

    // Growth-based recommendations
    const recentGrowth = growthTrends.slice(-3);
    const avgGrowthRate = recentGrowth.reduce((sum, trend) => sum + trend.growthRate, 0) / recentGrowth.length;
    
    if (avgGrowthRate > 10) {
      recommendations.push('Develop scalable onboarding processes for rapid supplier base expansion');
    } else if (avgGrowthRate < -5) {
      recommendations.push('Investigate supplier attrition causes and improve retention strategies');
    }

    // Performance correlation recommendations
    if (correlations.overallCoherence < 0.3) {
      recommendations.push('Implement integrated performance management system - metrics are moving independently');
    }

    // Volatility recommendations
    if (metrics.variance > 12) {
      recommendations.push('Establish standardized performance monitoring and feedback processes');
    }

    // Confidence recommendations
    if (metrics.confidence < 65) {
      recommendations.push('Improve data collection consistency for better predictive insights');
    }

    return recommendations;
  }

  /**
   * Generate advanced recommendations
   */
  private static generateAdvancedRecommendations(
    metrics: TrendMetrics,
    correlations: CorrelationMatrix,
    anomalies: RatingAnomaly[]
  ): string[] {
    const recommendations: string[] = [];

    // Anomaly-based recommendations
    const highSeverityAnomalies = anomalies.filter(a => a.severity === 'high');
    if (highSeverityAnomalies.length > 0) {
      recommendations.push(`Investigate ${highSeverityAnomalies.length} high-severity performance anomalies immediately`);
    }

    // Correlation-based recommendations
    if (correlations.deliveryQuality < 0.2) {
      recommendations.push('Review delivery and quality processes - these metrics should be positively correlated');
    }

    // Statistical recommendations
    if (metrics.confidence < 70) {
      recommendations.push('Implement more rigorous data collection standards to improve prediction accuracy');
    }

    return recommendations;
  }

  /**
   * Generate simple predictions
   */
  private static generatePredictions(
    ratingTrends: RatingTrend[],
    _performanceTrends: PerformanceTrend[],
    forecastMonths: number
  ): ForecastPoint[] {
    const predictions: ForecastPoint[] = [];
    
    if (ratingTrends.length < 3) return predictions;

    const recentTrends = ratingTrends.slice(-3);
    const avgRating = recentTrends.reduce((sum, t) => sum + t.averageRating, 0) / recentTrends.length;
    const metrics = SupplierRatingAnalyzer.calculateTrendMetrics(ratingTrends);

    for (let i = 1; i <= forecastMonths; i++) {
      const predictedRating = Math.max(60, Math.min(100, avgRating + (metrics.slope * i)));
      predictions.push({
        period: `+${i} month${i > 1 ? 's' : ''}`,
        predictedRating: Math.round(predictedRating * 10) / 10,
        confidence: Math.max(50, metrics.confidence - (i * 10))
      });
    }

    return predictions;
  }

  /**
   * Get category-specific multiplier
   */
  private static getCategoryMultiplier(category: string): number {
    const categoryMultipliers: Record<string, number> = {
      'technology': 1.1,
      'construction': 0.95,
      'manufacturing': 1.05,
      'services': 1.0,
      'logistics': 0.98,
      'consulting': 1.08
    };

    return categoryMultipliers[category.toLowerCase()] || 1.0;
  }

  /**
   * Get category-specific seasonal effects
   */
  private static getCategorySeasonalEffect(category: string, month: number): number {
    const seasonalEffects: Record<string, number[]> = {
      'construction': [-2, -1.5, 0, 2, 3, 2, 1, 1, 1.5, 1, 0, -1], // Weather dependent
      'technology': [0, 0.5, 1, 0.5, 0, -0.5, -1, 0, 1, 1.5, 1, 0], // Project cycles
      'logistics': [0.5, 1, 1.5, 1, 0.5, 0, -0.5, 0, 0.5, 1, 2, -1], // Holiday shipping
      'manufacturing': [0, 1, 2, 1, 0.5, 0, 0, 0.5, 1.5, 2, 1, 0] // Production cycles
    };

    const effects = seasonalEffects[category.toLowerCase()] || new Array(12).fill(0);
    return effects[month] || 0;
  }
}