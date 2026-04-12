/**
 * Benchmark Calculator Module
 * Handles benchmarking and trend analysis for supplier scorecards
 */

import { Supplier } from '@/types/supplier/base.types';
import { ProductCategory } from '@/types/supplier/common.types';
import { TrendData, BenchmarkData } from './types';

interface HistoricalDataPoint {
  date: Date | string;
  score: number;
}
import { ScoreCalculator } from './scoreCalculator';
import { SupplierUtils } from './utils';
import { log } from '@/lib/logger';

export class BenchmarkCalculator {
  /**
   * Calculate performance trends
   */
  static async calculateTrends(supplier: Supplier): Promise<TrendData> {
    // This would ideally use historical data
    // For now, we'll use simplified trend calculation based on current metrics
    const currentScore = ScoreCalculator.calculateOverallScore(supplier);
    
    // Simulate trend data - in real implementation, this would query historical records
    const trendVariation = Math.random() * 10 - 5; // ±5 point variation
    
    return {
      last3Months: Math.max(0, Math.min(100, currentScore + (trendVariation * 0.5))),
      last6Months: Math.max(0, Math.min(100, currentScore + trendVariation)),
      last12Months: Math.max(0, Math.min(100, currentScore + (trendVariation * 1.5)))
    };
  }

  /**
   * Calculate historical trends with actual data
   */
  static async calculateHistoricalTrends(
    supplier: Supplier,
    historicalData: HistoricalDataPoint[]
  ): Promise<TrendData> {
    if (!historicalData || historicalData.length === 0) {
      return this.calculateTrends(supplier);
    }

    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const last3MonthsData = historicalData.filter(data => 
      new Date(data.date) >= threeMonthsAgo
    );
    const last6MonthsData = historicalData.filter(data => 
      new Date(data.date) >= sixMonthsAgo
    );
    const last12MonthsData = historicalData.filter(data => 
      new Date(data.date) >= twelveMonthsAgo
    );

    return {
      last3Months: this.calculateAverageScore(last3MonthsData),
      last6Months: this.calculateAverageScore(last6MonthsData),
      last12Months: this.calculateAverageScore(last12MonthsData)
    };
  }

  /**
   * Calculate benchmarks against industry/category
   */
  static async calculateBenchmarks(supplier: Supplier): Promise<BenchmarkData> {
    try {
      // Get all suppliers for comparison
      const supplierCrudService = await import('../../supplier.crud');
      const allSuppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      // Industry percentile (all suppliers)
      const allScores = allSuppliers
        .map(s => ScoreCalculator.calculateOverallScore(s))
        .filter(score => score > 0)
        .sort((a, b) => a - b);
      
      const supplierScore = supplier.overallScore || 0;
      const industryPercentile = SupplierUtils.calculatePercentile(supplierScore, allScores);

      // Category percentile
      let categoryPercentile = 50; // Default
      if (supplier.categories && supplier.categories.length > 0) {
        const categorySuppliers = allSuppliers.filter(s => 
          s.categories?.some(cat => supplier.categories!.includes(cat))
        );
        
        const categoryScores = categorySuppliers
          .map(s => ScoreCalculator.calculateOverallScore(s))
          .filter(score => score > 0)
          .sort((a, b) => a - b);
        
        categoryPercentile = SupplierUtils.calculatePercentile(supplierScore, categoryScores);
      }

      // Peer comparison
      let peerComparison: 'above' | 'at' | 'below';
      if (industryPercentile >= 75) {
        peerComparison = 'above';
      } else if (industryPercentile <= 25) {
        peerComparison = 'below';
      } else {
        peerComparison = 'at';
      }

      return {
        industryPercentile: Math.round(industryPercentile),
        categoryPercentile: Math.round(categoryPercentile),
        peerComparison
      };
    } catch (error) {
      log.error('Error calculating benchmarks:', { data: error }, 'benchmarkCalculator');
      return {
        industryPercentile: 50,
        categoryPercentile: 50,
        peerComparison: 'at'
      };
    }
  }

  /**
   * Calculate category-specific benchmarks
   */
  static async calculateCategoryBenchmarks(
    supplier: Supplier,
    category: string
  ): Promise<{
    percentile: number;
    rank: number;
    totalInCategory: number;
    topPerformers: string[];
  }> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const allSuppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      const categorySuppliers = allSuppliers.filter(s =>
        s.categories?.includes(category as ProductCategory)
      );

      if (categorySuppliers.length === 0) {
        return {
          percentile: 50,
          rank: 1,
          totalInCategory: 1,
          topPerformers: []
        };
      }

      const supplierScore = ScoreCalculator.calculateOverallScore(supplier);
      // Note: supplierScore could be used for additional validation or logging
      // Currently focusing on categoryScores below
      const categoryScores = categorySuppliers
        .map(s => ({
          id: s.id,
          name: SupplierUtils.getSupplierDisplayName(s),
          score: ScoreCalculator.calculateOverallScore(s)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

      const supplierIndex = categoryScores.findIndex(item => item.id === supplier.id);
      const rank = supplierIndex >= 0 ? supplierIndex + 1 : categoryScores.length;
      const percentile = categoryScores.length > 1 ? 
        ((categoryScores.length - rank) / (categoryScores.length - 1)) * 100 : 50;

      const topPerformers = categoryScores
        .slice(0, Math.min(5, categoryScores.length))
        .map(item => item.name);

      return {
        percentile: Math.round(percentile),
        rank,
        totalInCategory: categoryScores.length,
        topPerformers
      };
    } catch (error) {
      log.error('Error calculating category benchmarks:', { data: error }, 'benchmarkCalculator');
      return {
        percentile: 50,
        rank: 1,
        totalInCategory: 1,
        topPerformers: []
      };
    }
  }

  /**
   * Calculate regional benchmarks
   */
  static async calculateRegionalBenchmarks(
    supplier: Supplier
  ): Promise<{
    cityRank: number;
    provinceRank: number;
    countryRank: number;
    regionPercentile: number;
  }> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const allSuppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      const supplierScore = ScoreCalculator.calculateOverallScore(supplier);
      // Note: supplierScore could be used for regional comparison validation
      // Currently using supplier location for geographic ranking
      const supplierAddress = supplier.addresses?.physical;

      if (!supplierAddress) {
        return {
          cityRank: 1,
          provinceRank: 1,
          countryRank: 1,
          regionPercentile: 50
        };
      }

      // City ranking
      const citySuppliers = allSuppliers.filter(s => 
        s.addresses?.physical?.city === supplierAddress.city
      );
      const cityRank = this.calculateRank(supplier, citySuppliers);

      // Province ranking
      const provinceSuppliers = allSuppliers.filter(s => 
        s.addresses?.physical?.state === supplierAddress.state
      );
      const provinceRank = this.calculateRank(supplier, provinceSuppliers);

      // Country ranking
      const countrySuppliers = allSuppliers.filter(s => 
        s.addresses?.physical?.country === supplierAddress.country
      );
      const countryRank = this.calculateRank(supplier, countrySuppliers);

      // Regional percentile (province level)
      const provinceScores = provinceSuppliers
        .map(s => ScoreCalculator.calculateOverallScore(s))
        .filter(score => score > 0)
        .sort((a, b) => a - b);
      
      const regionalSupplierScore = supplier.overallScore || 0;
      const regionPercentile = SupplierUtils.calculatePercentile(regionalSupplierScore, provinceScores);

      return {
        cityRank,
        provinceRank,
        countryRank,
        regionPercentile: Math.round(regionPercentile)
      };
    } catch (error) {
      log.error('Error calculating regional benchmarks:', { data: error }, 'benchmarkCalculator');
      return {
        cityRank: 1,
        provinceRank: 1,
        countryRank: 1,
        regionPercentile: 50
      };
    }
  }

  /**
   * Helper method to calculate average score from historical data
   */
  private static calculateAverageScore(data: HistoricalDataPoint[]): number {
    if (!data || data.length === 0) return 0;
    
    const sum = data.reduce((acc, item) => acc + (item.score || 0), 0);
    return Math.round(sum / data.length);
  }

  /**
   * Helper method to calculate rank within a group
   */
  private static calculateRank(supplier: Supplier, suppliers: Supplier[]): number {
    const scores = suppliers
      .map(s => ({
        id: s.id,
        score: ScoreCalculator.calculateOverallScore(s)
      }))
      .sort((a, b) => b.score - a.score);

    const index = scores.findIndex(item => item.id === supplier.id);
    return index >= 0 ? index + 1 : scores.length;
  }
}