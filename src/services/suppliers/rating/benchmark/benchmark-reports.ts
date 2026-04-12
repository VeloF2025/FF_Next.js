/**
 * Benchmark Reports
 * Generates benchmark reports, trends, and analytics
 */

import { BenchmarkCalculator } from './benchmark-calculator';
import { ComparisonEngine } from './comparison-engine';
import { log } from '@/lib/logger';
import {
  BenchmarkTrendPoint,
  TrendAnalysisConfig,
  ComparisonReportOptions,
  BenchmarkValidationResult,
  SupplierComparison,
  BenchmarkData,
  CategoryRanking
} from './benchmark-types';

/**
 * Category analysis entry used in industry reports
 */
interface CategoryAnalysisEntry {
  averageScore: number;
  supplierCount: number;
  topPerformers: number;
}

/**
 * Summarized comparison used when format === 'summary'
 */
interface SummarizedComparison {
  overallScore: number;
  industryDifference: number;
  topPerformerDifference: number;
}

/**
 * Benchmark reporting and analytics engine
 */
export class BenchmarkReports {
  /**
   * Get benchmark trends over time
   */
  static async getBenchmarkTrends(config: TrendAnalysisConfig): Promise<BenchmarkTrendPoint[]> {
    try {
      // In a real implementation, this would query historical benchmark data
      // For now, return mock trend data as specified in the original implementation
      if (config.generateMockData !== false) {
        return this.generateMockTrendData(config);
      }

      // TODO: Implement real historical data query
      return this.queryHistoricalTrends(config);
    } catch (error) {
      log.error('Error getting benchmark trends:', { data: error }, 'benchmark-reports');
      return [];
    }
  }

  /**
   * Generate mock trend data for demonstration
   */
  private static generateMockTrendData(config: TrendAnalysisConfig): BenchmarkTrendPoint[] {
    const trends: BenchmarkTrendPoint[] = [];
    const currentDate = new Date();
    
    for (let i = config.months - 1; i >= 0; i--) {
      const periodDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const periodName = periodDate.toISOString().substring(0, 7); // YYYY-MM format
      
      const baseAverage = 75 + Math.random() * 10;
      const topPerformerBase = 90 + Math.random() * 8;
      
      // Apply smoothing factor if specified
      const smoothingFactor = config.smoothingFactor || 1;
      const smoothedBase = baseAverage * smoothingFactor;
      const smoothedTop = topPerformerBase * smoothingFactor;
      
      const categoryAverages: Record<string, number> = {};
      const defaultCategories = ['Electronics', 'Materials', 'Services', 'Equipment'];
      const categories = config.includeCategories || defaultCategories;
      
      categories.forEach(category => {
        categoryAverages[category] = Math.round(smoothedBase + (Math.random() - 0.5) * 10);
      });
      
      trends.push({
        period: periodName,
        industryAverage: Math.round(smoothedBase),
        topPerformerAverage: Math.round(smoothedTop),
        categoryAverages
      });
    }
    
    return trends;
  }

  /**
   * Query actual historical trends (placeholder for real implementation)
   */
  private static async queryHistoricalTrends(config: TrendAnalysisConfig): Promise<BenchmarkTrendPoint[]> {
    // This would integrate with a time-series database or data warehouse
    // to retrieve actual historical benchmark data
    log.warn('Historical trend querying not yet implemented', undefined, 'benchmark-reports');
    return this.generateMockTrendData(config);
  }

  /**
   * Generate comprehensive supplier comparison report
   */
  static async generateComparisonReport(
    supplierId: string,
    options: ComparisonReportOptions = {}
  ): Promise<{
    summary: {
      supplierName: string;
      overallRanking: string;
      keyStrengths: string[];
      improvementAreas: string[];
    };
    detailedComparison: SupplierComparison | SummarizedComparison;
    historicalTrends?: BenchmarkTrendPoint[];
    categoryRankings?: CategoryRanking[];
    recommendations: string[];
  }> {
    try {
      const comparison = await ComparisonEngine.compareSupplier(supplierId);
      const supplier = await this.getSupplierBasicInfo(supplierId);
      
      // Generate summary
      const summary = {
        supplierName: supplier.name,
        overallRanking: this.determineOverallRanking(comparison),
        keyStrengths: this.identifyKeyStrengths(comparison),
        improvementAreas: this.identifyImprovementAreas(comparison)
      };

      // Get detailed comparison
      const detailedComparison = options.format === 'summary' ? 
        this.summarizeComparison(comparison) : comparison;

      // Include historical data if requested
      let historicalTrends: BenchmarkTrendPoint[] | undefined;
      if (options.includeHistoricalData) {
        historicalTrends = await this.getBenchmarkTrends({ months: 12 });
      }

      // Include category rankings if requested
      let categoryRankings: CategoryRanking[] | undefined;
      if (options.includeCategoryRankings && comparison.categoryRanking) {
        categoryRankings = comparison.categoryRanking;
      }

      // Generate recommendations
      const recommendations = options.includeRecommendations ?
        this.generateRecommendations(comparison) : [];

      const result: {
        summary: typeof summary;
        detailedComparison: SupplierComparison | SummarizedComparison;
        recommendations: string[];
        historicalTrends?: BenchmarkTrendPoint[];
        categoryRankings?: CategoryRanking[];
      } = {
        summary,
        detailedComparison,
        recommendations
      };
      
      if (historicalTrends) {
        result.historicalTrends = historicalTrends;
      }
      
      if (categoryRankings) {
        result.categoryRankings = categoryRankings;
      }
      
      return result;
    } catch (error) {
      log.error('Error generating comparison report:', { data: error }, 'benchmark-reports');
      throw error;
    }
  }

  /**
   * Generate industry benchmark report
   */
  static async generateIndustryReport(): Promise<{
    overview: {
      totalSuppliers: number;
      averageScore: number;
      topPerformerThreshold: number;
      categoryCount: number;
    };
    benchmarks: BenchmarkData;
    trends: BenchmarkTrendPoint[];
    categoryAnalysis: Record<string, CategoryAnalysisEntry>;
    insights: string[];
  }> {
    try {
      const benchmarks = await BenchmarkCalculator.calculateBenchmarks();
      const trends = await this.getBenchmarkTrends({ months: 12 });
      
      // Calculate overview metrics
      const categoryCount = Object.keys(benchmarks.categoryBenchmarks).length;
      const overview = {
        totalSuppliers: await this.getTotalSupplierCount(),
        averageScore: benchmarks.industryAverages.overallScore,
        topPerformerThreshold: benchmarks.topPerformers.overallScore,
        categoryCount
      };

      // Analyze categories
      const categoryAnalysis: Record<string, CategoryAnalysisEntry> = {};
      for (const [category, data] of Object.entries(benchmarks.categoryBenchmarks)) {
        categoryAnalysis[category] = {
          averageScore: data.overallScore,
          supplierCount: data.sampleSize,
          topPerformers: Math.ceil(data.sampleSize * 0.1) // Top 10%
        };
      }

      // Generate insights
      const insights = this.generateIndustryInsights(benchmarks, trends, categoryAnalysis);

      return {
        overview,
        benchmarks,
        trends,
        categoryAnalysis,
        insights
      };
    } catch (error) {
      log.error('Error generating industry report:', { data: error }, 'benchmark-reports');
      throw error;
    }
  }

  /**
   * Validate benchmark data quality
   */
  static async validateBenchmarkData(): Promise<BenchmarkValidationResult> {
    try {
      const benchmarks = await BenchmarkCalculator.calculateBenchmarks();
      const errors: string[] = [];
      const warnings: string[] = [];
      
      // Validate sample sizes
      const totalCategories = Object.keys(benchmarks.categoryBenchmarks).length;
      if (totalCategories === 0) {
        errors.push('No category data available');
      }

      // Check for categories with insufficient sample sizes
      Object.entries(benchmarks.categoryBenchmarks).forEach(([category, data]) => {
        if (data.sampleSize < 3) {
          warnings.push(`Category '${category}' has low sample size: ${data.sampleSize}`);
        }
      });

      // Validate score ranges
      const avgScores = benchmarks.industryAverages;
      Object.entries(avgScores).forEach(([metric, score]) => {
        if (score < 0 || score > 100) {
          errors.push(`Invalid ${metric}: ${score} (should be 0-100)`);
        }
      });

      // Calculate data quality metrics
      const totalSuppliers = await this.getTotalSupplierCount();
      const validSuppliers = totalSuppliers; // Simplified - would need actual validation
      const completenessScore = totalCategories > 0 ? Math.min(100, (totalCategories / 10) * 100) : 0;
      const reliabilityScore = validSuppliers > 10 ? 100 : (validSuppliers / 10) * 100;

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        dataQuality: {
          sampleSize: totalSuppliers,
          completenessScore,
          reliabilityScore
        }
      };
    } catch (error) {
      log.error('Error validating benchmark data:', { data: error }, 'benchmark-reports');
      return {
        valid: false,
        errors: ['Validation failed due to system error'],
        warnings: [],
        dataQuality: {
          sampleSize: 0,
          completenessScore: 0,
          reliabilityScore: 0
        }
      };
    }
  }

  // Helper methods

  private static async getSupplierBasicInfo(supplierId: string): Promise<{ name: string }> {
    // This would typically be a more comprehensive supplier fetch
    return { name: `Supplier ${supplierId}` };
  }

  private static async getTotalSupplierCount(): Promise<number> {
    // This would query the actual supplier count
    return 100; // Placeholder
  }

  private static determineOverallRanking(comparison: SupplierComparison): string {
    const overallDiff = comparison.industryComparison.overallDiff;
    if (overallDiff > 10) return 'Above Average';
    if (overallDiff > -5) return 'Average';
    return 'Below Average';
  }

  private static identifyKeyStrengths(comparison: SupplierComparison): string[] {
    const strengths: string[] = [];
    const industryComp = comparison.industryComparison;
    
    if (industryComp.deliveryDiff > 5) strengths.push('Delivery Performance');
    if (industryComp.qualityDiff > 5) strengths.push('Quality');
    if (industryComp.priceDiff > 5) strengths.push('Pricing');
    if (industryComp.serviceDiff > 5) strengths.push('Service');
    
    return strengths;
  }

  private static identifyImprovementAreas(comparison: SupplierComparison): string[] {
    const areas: string[] = [];
    const industryComp = comparison.industryComparison;
    
    if (industryComp.deliveryDiff < -5) areas.push('Delivery Performance');
    if (industryComp.qualityDiff < -5) areas.push('Quality');
    if (industryComp.priceDiff < -5) areas.push('Pricing');
    if (industryComp.serviceDiff < -5) areas.push('Service');
    
    return areas;
  }

  private static summarizeComparison(comparison: SupplierComparison): SummarizedComparison {
    return {
      overallScore: comparison.supplierScores.overallScore,
      industryDifference: comparison.industryComparison.overallDiff,
      topPerformerDifference: comparison.topPerformersComparison.overallDiff
    };
  }

  private static generateRecommendations(comparison: SupplierComparison): string[] {
    const recommendations: string[] = [];
    const industryComp = comparison.industryComparison;
    
    if (industryComp.overallDiff < 0) {
      recommendations.push('Focus on overall performance improvement to reach industry average');
    }
    
    if (industryComp.deliveryDiff < -10) {
      recommendations.push('Implement delivery performance improvement program');
    }
    
    if (industryComp.qualityDiff < -10) {
      recommendations.push('Invest in quality management systems');
    }
    
    return recommendations;
  }

  private static generateIndustryInsights(_benchmarks: BenchmarkData, trends: BenchmarkTrendPoint[], categoryAnalysis: Record<string, CategoryAnalysisEntry>): string[] {
    const insights: string[] = [];
    
    // Trend insights
    if (trends.length > 1) {
      const firstMonth = trends[0]!;
      const lastMonth = trends[trends.length - 1]!;
      const avgChange = lastMonth.industryAverage - firstMonth.industryAverage;
      
      if (avgChange > 2) {
        insights.push('Industry performance is trending upward');
      } else if (avgChange < -2) {
        insights.push('Industry performance is declining');
      } else {
        insights.push('Industry performance is stable');
      }
    }
    
    // Category insights
    const categoryScores = Object.values(categoryAnalysis).map((c) => c.averageScore);
    const highestCategoryScore = Math.max(...categoryScores);
    const lowestCategoryScore = Math.min(...categoryScores);
    
    insights.push(`Performance gap between best and worst categories: ${highestCategoryScore - lowestCategoryScore} points`);
    
    return insights;
  }
}