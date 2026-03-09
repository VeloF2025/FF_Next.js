/**
 * Performance Analysis Engine
 * Core analysis logic for supplier performance trends and benchmarks
 */

import { Supplier } from '@/types/supplier/base.types';
import { PerformanceTrends, PerformanceBenchmarks, TrendAnalysis, BenchmarkStats } from './analyzer-types';
import { PerformanceMetricsCalculator } from './performance-metrics';
import { log } from '@/lib/logger';

export class PerformanceAnalysisEngine {
  /**
   * Analyze performance trends for suppliers
   */
  static analyzePerformanceTrends(suppliers: Supplier[]): {
    averageRating: number;
    averagePerformance: number;
    topPerformers: number;
    underPerformers: number;
    complianceRate: number;
  } {
    const averageRating = PerformanceMetricsCalculator.calculateAverageRating(suppliers);
    const averagePerformance = PerformanceMetricsCalculator.calculateAveragePerformance(suppliers);
    
    const topPerformers = PerformanceMetricsCalculator.identifyTopPerformers(suppliers);
    const underPerformers = PerformanceMetricsCalculator.identifyUnderperformers(suppliers);
    
    // Calculate compliance rate based on supplier compliance status
    const compliantSuppliers = suppliers.filter(s => 
      s.complianceStatus && (s.complianceStatus as any).overall === 'compliant'
    );
    const complianceRate = suppliers.length > 0 ? compliantSuppliers.length / suppliers.length : 0;

    return {
      averageRating,
      averagePerformance,
      topPerformers: topPerformers.length,
      underPerformers: underPerformers.length,
      complianceRate
    };
  }

  /**
   * Get all categories from suppliers
   */
  static getAllCategories(suppliers: Supplier[]): string[] {
    const categories = new Set<string>();
    suppliers.forEach(supplier => {
      if (supplier.category) {
        categories.add(supplier.category);
      }
    });
    return Array.from(categories);
  }

  /**
   * Get all business types from suppliers
   */
  static getAllBusinessTypes(suppliers: Supplier[]): string[] {
    const types = new Set<string>();
    suppliers.forEach(supplier => {
      if (supplier.businessType) {
        types.add(supplier.businessType);
      }
    });
    return Array.from(types);
  }

  /**
   * Calculate benchmark statistics for a group of values
   */
  static calculateBenchmarkStats(values: number[]): BenchmarkStats {
    if (values.length === 0) {
      return {
        mean: 0,
        median: 0,
        q1: 0,
        q3: 0,
        min: 0,
        max: 0,
        standardDeviation: 0,
        sampleSize: 0
      };
    }

    const sortedValues = [...values].sort((a, b) => a - b);
    const quartiles = PerformanceMetricsCalculator.calculateQuartiles(sortedValues);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const standardDeviation = PerformanceMetricsCalculator.calculateStandardDeviation(values);

    return {
      mean: Math.round(mean * 100) / 100,
      median: quartiles.median,
      q1: quartiles.q1,
      q3: quartiles.q3,
      min: quartiles.min,
      max: quartiles.max,
      standardDeviation: Math.round(standardDeviation * 100) / 100,
      sampleSize: values.length
    };
  }

  /**
   * Generate performance trends over time
   */
  static async generatePerformanceTrends(months: number = 12): Promise<PerformanceTrends[]> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();

      const trends: PerformanceTrends[] = [];
      const now = new Date();

      for (let i = months - 1; i >= 0; i--) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
        
        // Get suppliers that existed by this month
        const existingSuppliers = suppliers.filter(s => 
          s.createdAt && new Date(s.createdAt) <= monthEnd
        );

        // Get suppliers added this month
        const newSuppliers = suppliers.filter(s => {
          if (!s.createdAt) return false;
          const createdDate = new Date(s.createdAt);
          return createdDate.getFullYear() === targetDate.getFullYear() &&
                 createdDate.getMonth() === targetDate.getMonth();
        });

        const performanceData = this.analyzePerformanceTrends(existingSuppliers);
        
        // Get category breakdown
        const categoryBreakdown: Record<string, number> = {};
        const categories = this.getAllCategories(existingSuppliers);
        
        categories.forEach(category => {
          const categorySuppliers = existingSuppliers.filter(s => s.category === category);
          categoryBreakdown[category] = categorySuppliers.length;
        });

        trends.push({
          month: targetDate.toLocaleDateString('en-US', { month: 'long' }),
          year: targetDate.getFullYear(),
          totalSuppliers: existingSuppliers.length,
          newSuppliers: newSuppliers.length,
          activeSuppliers: existingSuppliers.filter(s => s.status === 'active').length,
          averageRating: performanceData.averageRating,
          averagePerformance: performanceData.averagePerformance,
          complianceRate: performanceData.complianceRate || 0,
          topPerformers: performanceData.topPerformers,
          underPerformers: performanceData.underPerformers,
          categoryBreakdown
        });
      }

      return trends;
    } catch (error) {
      log.error('Error generating performance trends:', { data: error }, 'analyzer-engine');
      return [];
    }
  }

  /**
   * Generate performance benchmarks
   */
  static async generatePerformanceBenchmarks(): Promise<PerformanceBenchmarks> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      const allRatings = suppliers
        .map(s => PerformanceMetricsCalculator.getSupplierRating(s))
        .filter(rating => rating > 0);

      const overall = this.calculateBenchmarkStats(allRatings);

      // Benchmarks by category
      const byCategory: Record<string, BenchmarkStats> = {};
      const categories = this.getAllCategories(suppliers);
      
      categories.forEach(category => {
        const categorySuppliers = suppliers.filter(s => s.category === category);
        const categoryRatings = categorySuppliers
          .map(s => PerformanceMetricsCalculator.getSupplierRating(s))
          .filter(rating => rating > 0);
        
        if (categoryRatings.length > 0) {
          byCategory[category] = {
            ...this.calculateBenchmarkStats(categoryRatings)
          };
        }
      });

      // Benchmarks by business type
      const byBusinessType: Record<string, BenchmarkStats> = {};
      const businessTypes = this.getAllBusinessTypes(suppliers);
      
      businessTypes.forEach(businessType => {
        const typeSuppliers = suppliers.filter(s => s.businessType === businessType);
        const typeRatings = typeSuppliers
          .map(s => PerformanceMetricsCalculator.getSupplierRating(s))
          .filter(rating => rating > 0);

        if (typeRatings.length > 0) {
          byBusinessType[businessType] = {
            ...this.calculateBenchmarkStats(typeRatings)
          };
        }
      });

      return {
        overall,
        byCategory,
        byBusinessType,
        trends: {
          improving: 0,
          stable: 0,
          declining: 0
        },
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      log.error('Error generating performance benchmarks:', { data: error }, 'analyzer-engine');
      return {
        overall: this.calculateBenchmarkStats([]),
        byCategory: {},
        byBusinessType: {},
        trends: {
          improving: 0,
          stable: 0,
          declining: 0
        },
        lastUpdated: new Date().toISOString()
      };
    }
  }

  /**
   * Analyze trends and generate analysis results
   */
  static async analyzeTrends(): Promise<TrendAnalysis[]> {
    try {
      const trends = await this.generatePerformanceTrends(12);
      const analyses: TrendAnalysis[] = [];

      if (trends.length < 2) {
        return analyses;
      }

      // Analyze overall rating trend
      const ratingTrend = this.analyzeTrendSeries(
        trends.map(t => ({ date: `${t.month} ${t.year}`, value: t.averageRating })),
        'Overall Rating'
      );
      if (ratingTrend) analyses.push(ratingTrend);

      // Analyze performance trend
      const performanceTrend = this.analyzeTrendSeries(
        trends.map(t => ({ date: `${t.month} ${t.year}`, value: t.averagePerformance })),
        'Overall Performance'
      );
      if (performanceTrend) analyses.push(performanceTrend);

      // Analyze supplier count trend
      const supplierCountTrend = this.analyzeTrendSeries(
        trends.map(t => ({ date: `${t.month} ${t.year}`, value: t.totalSuppliers })),
        'Supplier Count'
      );
      if (supplierCountTrend) analyses.push(supplierCountTrend);

      // Analyze new supplier trend
      const newSupplierTrend = this.analyzeTrendSeries(
        trends.map(t => ({ date: `${t.month} ${t.year}`, value: t.newSuppliers })),
        'New Suppliers'
      );
      if (newSupplierTrend) analyses.push(newSupplierTrend);

      return analyses;
    } catch (error) {
      log.error('Error analyzing trends:', { data: error }, 'analyzer-engine');
      return [];
    }
  }

  /**
   * Analyze a series of data points for trends
   */
  private static analyzeTrendSeries(
    dataPoints: { date: string; value: number }[],
    category: string
  ): TrendAnalysis | null {
    if (dataPoints.length < 2) return null;

    const latest = dataPoints[dataPoints.length - 1]!;
    const previous = dataPoints[dataPoints.length - 2]!;
    
    const changePercent = PerformanceMetricsCalculator.calculateChangePercentage(
      latest.value, 
      previous.value
    );

    const trend = PerformanceMetricsCalculator.determineTrend(changePercent);
    const significance = PerformanceMetricsCalculator.determineSignificance(Math.abs(changePercent));

    return {
      category,
      timeframe: 'Monthly',
      trend,
      significance,
      changePercent: Math.round(changePercent * 100) / 100,
      currentValue: latest.value,
      previousValue: previous.value,
      dataPoints: dataPoints.map(dp => ({
        date: dp.date,
        value: dp.value,
        supplierCount: 0 // Would need additional data to calculate this
      }))
    };
  }
}