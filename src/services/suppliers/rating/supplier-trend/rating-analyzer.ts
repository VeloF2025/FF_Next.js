/**
 * Rating Analyzer
 * Core rating trend analysis functionality
 */

import type { RatingTrend, TrendMetrics } from './trend-types';
import { log } from '@/lib/logger';

export class SupplierRatingAnalyzer {
  /**
   * Analyze rating trends across time periods
   */
  static async analyzeRatingTrends(months: number = 12): Promise<RatingTrend[]> {
    try {
      // In a real implementation, this would query historical rating data
      // For now, return mock trend analysis with realistic patterns
      const trends: RatingTrend[] = [];
      const currentDate = new Date();
      
      // Base values for realistic trend generation
      const baseRating = 78; // Starting baseline rating
      let seasonalFactor = 0;
      let supplierCount = 45;
      
      for (let i = months - 1; i >= 0; i--) {
        const periodDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const periodName = periodDate.toISOString().substring(0, 7); // YYYY-MM format
        
        // Add seasonal variation (higher in Q4, lower in Q2)
        const month = periodDate.getMonth();
        if (month >= 9) { // Q4 - holiday season, better performance
          seasonalFactor = 2 + Math.random() * 3;
        } else if (month >= 3 && month <= 5) { // Q2 - transition period
          seasonalFactor = -1 - Math.random() * 2;
        } else {
          seasonalFactor = Math.random() * 2 - 1;
        }
        
        // Add gradual improvement trend over time
        const improvementTrend = (months - i) * 0.3;
        
        // Random variation
        const randomVariation = (Math.random() - 0.5) * 6;
        
        // Calculate final rating
        const finalRating = Math.max(65, Math.min(95, 
          baseRating + seasonalFactor + improvementTrend + randomVariation
        ));
        
        // Supplier count fluctuation
        const countChange = Math.floor((Math.random() - 0.5) * 8);
        supplierCount = Math.max(30, Math.min(80, supplierCount + countChange));
        
        // New reviews based on supplier count and activity
        const newReviews = Math.floor((supplierCount * 0.6) + Math.random() * (supplierCount * 0.4));
        
        // Determine trend direction
        const previousRating: number = i < months - 1 ? trends[trends.length - 1]?.averageRating ?? baseRating : baseRating;
        const ratingDiff: number = finalRating - previousRating;
        
        trends.push({
          period: periodName,
          averageRating: Math.round(finalRating * 10) / 10,
          supplierCount,
          newReviews,
          trendDirection: ratingDiff > 1.5 ? 'up' : ratingDiff < -1.5 ? 'down' : 'stable'
        });
      }
      
      return trends;
    } catch (error) {
      log.error('Error analyzing rating trends:', { data: error }, 'rating-analyzer');
      return [];
    }
  }

  /**
   * Calculate trend metrics for statistical analysis
   */
  static calculateTrendMetrics(trends: RatingTrend[]): TrendMetrics {
    if (trends.length < 2) {
      return {
        slope: 0,
        variance: 0,
        correlation: 0,
        seasonality: false,
        confidence: 0
      };
    }

    const ratings = trends.map(t => t.averageRating);
    const periods = trends.map((_, index) => index);
    
    // Calculate slope (linear regression)
    const n = ratings.length;
    const sumX = periods.reduce((a, b) => a + b, 0);
    const sumY = ratings.reduce((a, b) => a + b, 0);
    const sumXY = periods.reduce((sum, x, i) => sum + x * ratings[i]!, 0);
    const sumXX = periods.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    // Calculate variance
    const mean = sumY / n;
    const variance = ratings.reduce((sum, rating) => sum + Math.pow(rating - mean, 2), 0) / n;
    
    // Calculate correlation coefficient
    const meanX = sumX / n;
    const numerator = periods.reduce((sum, x, i) => sum + (x - meanX) * (ratings[i]! - mean), 0);
    const denomX = Math.sqrt(periods.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0));
    const denomY = Math.sqrt(ratings.reduce((sum, y) => sum + Math.pow(y - mean, 2), 0));
    const correlation = numerator / (denomX * denomY);
    
    // Check for seasonality (simplified)
    const seasonality = variance > 5; // Threshold for seasonal variation
    
    // Calculate confidence based on trend consistency
    const consistentTrend = trends.reduce((count, trend, i) => {
      if (i === 0) return count;
      const expectedDirection = slope > 0.5 ? 'up' : slope < -0.5 ? 'down' : 'stable';
      return trend.trendDirection === expectedDirection ? count + 1 : count;
    }, 0);
    
    const confidence = Math.min(100, (consistentTrend / (trends.length - 1)) * 100);
    
    return {
      slope: Math.round(slope * 100) / 100,
      variance: Math.round(variance * 100) / 100,
      correlation: Math.round(correlation * 100) / 100,
      seasonality,
      confidence: Math.round(confidence)
    };
  }

  /**
   * Identify rating anomalies and outliers
   */
  static identifyRatingAnomalies(trends: RatingTrend[]): Array<{
    period: string;
    type: 'spike' | 'drop' | 'unusual_activity';
    severity: 'low' | 'medium' | 'high';
    description: string;
    impact: number;
  }> {
    const anomalies: Array<{
      period: string;
      type: 'spike' | 'drop' | 'unusual_activity';
      severity: 'low' | 'medium' | 'high';
      description: string;
      impact: number;
    }> = [];
    
    if (trends.length < 3) return anomalies;
    
    const ratings = trends.map(t => t.averageRating);
    const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    const stdDev = Math.sqrt(ratings.reduce((sum, rating) => sum + Math.pow(rating - mean, 2), 0) / ratings.length);
    
    trends.forEach((trend, index) => {
      const zScore = Math.abs(trend.averageRating - mean) / stdDev;
      
      if (zScore > 2) { // 2 standard deviations
        const isSpike = trend.averageRating > mean;
        const severity = zScore > 3 ? 'high' : zScore > 2.5 ? 'medium' : 'low';
        
        anomalies.push({
          period: trend.period,
          type: isSpike ? 'spike' : 'drop',
          severity,
          description: isSpike 
            ? `Unusually high rating of ${trend.averageRating} (${zScore.toFixed(1)}σ above mean)`
            : `Unusually low rating of ${trend.averageRating} (${zScore.toFixed(1)}σ below mean)`,
          impact: Math.round(Math.abs(trend.averageRating - mean) * 10) / 10
        });
      }
      
      // Check for unusual review activity
      if (index > 0) {
        const prevTrend = trends[index - 1]!;
        const reviewChange = Math.abs(trend.newReviews - prevTrend.newReviews);
        const reviewChangeRate = reviewChange / prevTrend.newReviews;
        
        if (reviewChangeRate > 0.5) { // 50% change in review volume
          anomalies.push({
            period: trend.period,
            type: 'unusual_activity',
            severity: reviewChangeRate > 1 ? 'high' : 'medium',
            description: `${reviewChangeRate > 0 ? 'Surge' : 'Drop'} in review activity: ${reviewChange} reviews vs previous period`,
            impact: reviewChange
          });
        }
      }
    });
    
    return anomalies.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  /**
   * Generate rating insights and recommendations
   */
  static generateRatingInsights(trends: RatingTrend[], metrics: TrendMetrics): {
    insights: string[];
    recommendations: string[];
  } {
    const insights: string[] = [];
    const recommendations: string[] = [];
    
    // Overall trend analysis
    if (metrics.slope > 0.5) {
      insights.push(`Positive trend: Ratings improving by ${metrics.slope.toFixed(1)} points per month on average`);
      recommendations.push('Continue current quality initiatives and identify best practices to replicate');
    } else if (metrics.slope < -0.5) {
      insights.push(`Negative trend: Ratings declining by ${Math.abs(metrics.slope).toFixed(1)} points per month on average`);
      recommendations.push('Urgent review of supplier performance management needed');
    } else {
      insights.push('Ratings remain stable with minimal long-term change');
      recommendations.push('Focus on identifying opportunities for breakthrough improvements');
    }
    
    // Volatility analysis
    if (metrics.variance > 10) {
      insights.push(`High volatility detected (variance: ${metrics.variance.toFixed(1)})`);
      recommendations.push('Implement more consistent performance monitoring and feedback processes');
    }
    
    // Seasonal patterns
    if (metrics.seasonality) {
      insights.push('Seasonal patterns detected in rating trends');
      recommendations.push('Develop seasonal performance strategies and resource planning');
    }
    
    // Recent performance
    const recentTrends = trends.slice(-3);
    const recentAvg = recentTrends.reduce((sum, t) => sum + t.averageRating, 0) / recentTrends.length;
    
    if (recentAvg > 85) {
      insights.push(`Excellent recent performance with ${recentAvg.toFixed(1)} average rating in last 3 months`);
    } else if (recentAvg < 75) {
      insights.push(`Below-average recent performance with ${recentAvg.toFixed(1)} average rating in last 3 months`);
      recommendations.push('Immediate intervention required for underperforming suppliers');
    }
    
    // Confidence assessment
    if (metrics.confidence < 60) {
      insights.push(`Low prediction confidence (${metrics.confidence}%) indicates inconsistent patterns`);
      recommendations.push('Establish more standardized evaluation criteria and processes');
    }
    
    return { insights, recommendations };
  }
}