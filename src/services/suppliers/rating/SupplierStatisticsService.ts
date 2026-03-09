/**
 * Supplier Statistics Service
 * Handles rating statistics and distributions
 */

import { RatingStatistics } from './types';
import { SupplierCrudService } from '../supplier.crud';
import { SupplierRatingManager } from './ratingManager';
import { log } from '@/lib/logger';

export class SupplierStatisticsService {
  /**
   * Get rating statistics across all suppliers
   */
  static async getRatingStatistics(): Promise<RatingStatistics> {
    try {
      const suppliers = await SupplierCrudService.getAll();
      
      let totalRating = 0;
      let totalReviews = 0;
      const ratingDistribution: Record<number, number> = {};
      const categoryTotals: Record<string, { total: number; count: number }> = {};

      suppliers.forEach(supplier => {
        const rating = SupplierRatingManager.normalizeRating(supplier.rating);
        
        if (rating.overall && rating.totalReviews && rating.totalReviews > 0) {
          totalRating += rating.overall;
          totalReviews += rating.totalReviews;
          
          // Rating distribution (1-5 stars)
          const starRating = Math.floor(rating.overall / 20) + 1; // Convert 0-100 to 1-5
          ratingDistribution[starRating] = (ratingDistribution[starRating] || 0) + 1;

          // Category averages
          supplier.categories?.forEach(category => {
            if (!categoryTotals[category]) {
              categoryTotals[category] = { total: 0, count: 0 };
            }
            categoryTotals[category].total += rating.overall ?? 0;
            categoryTotals[category].count += 1;
          });
        }
      });

      const categoryAverages: Record<string, number> = {};
      Object.entries(categoryTotals).forEach(([category, data]) => {
        categoryAverages[category] = data.count > 0 ? Math.round(data.total / data.count) : 0;
      });

      return {
        averageRating: suppliers.length > 0 ? Math.round(totalRating / suppliers.length) : 0,
        totalReviews,
        ratingDistribution,
        categoryAverages
      };
    } catch (error) {
      log.error('Error getting rating statistics:', { data: error }, 'SupplierStatisticsService');
      throw new Error(`Failed to get rating statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get detailed rating breakdown
   */
  static async getRatingBreakdown(): Promise<{
    excellent: number;  // 90-100
    good: number;      // 70-89
    average: number;   // 50-69
    poor: number;      // 30-49
    terrible: number;  // 0-29
  }> {
    try {
      const suppliers = await SupplierCrudService.getAll();
      
      const breakdown = {
        excellent: 0,
        good: 0,
        average: 0,
        poor: 0,
        terrible: 0
      };

      suppliers.forEach(supplier => {
        const rating = SupplierRatingManager.normalizeRating(supplier.rating);
        const overallRating = rating.overall || 0;
        
        if (overallRating >= 90) breakdown.excellent++;
        else if (overallRating >= 70) breakdown.good++;
        else if (overallRating >= 50) breakdown.average++;
        else if (overallRating >= 30) breakdown.poor++;
        else breakdown.terrible++;
      });

      return breakdown;
    } catch (error) {
      log.error('Error getting rating breakdown:', { data: error }, 'SupplierStatisticsService');
      return {
        excellent: 0,
        good: 0,
        average: 0,
        poor: 0,
        terrible: 0
      };
    }
  }

  /**
   * Get supplier count by category
   */
  static async getSupplierCountByCategory(): Promise<Record<string, number>> {
    try {
      const suppliers = await SupplierCrudService.getAll();
      const categoryCounts: Record<string, number> = {};

      suppliers.forEach(supplier => {
        supplier.categories?.forEach(category => {
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        });
      });

      return categoryCounts;
    } catch (error) {
      log.error('Error getting supplier count by category:', { data: error }, 'SupplierStatisticsService');
      return {};
    }
  }

  /**
   * Get review volume statistics
   */
  static async getReviewVolumeStats(): Promise<{
    totalReviews: number;
    averageReviewsPerSupplier: number;
    suppliersWithReviews: number;
    suppliersWithoutReviews: number;
    highVolumeSuppliers: number; // >10 reviews
    mediumVolumeSuppliers: number; // 5-10 reviews  
    lowVolumeSuppliers: number; // 1-4 reviews
  }> {
    try {
      const suppliers = await SupplierCrudService.getAll();
      
      let totalReviews = 0;
      let suppliersWithReviews = 0;
      let suppliersWithoutReviews = 0;
      let highVolumeSuppliers = 0;
      let mediumVolumeSuppliers = 0;
      let lowVolumeSuppliers = 0;

      suppliers.forEach(supplier => {
        const rating = SupplierRatingManager.normalizeRating(supplier.rating);
        const reviewCount = rating.totalReviews || 0;
        
        if (reviewCount > 0) {
          suppliersWithReviews++;
          totalReviews += reviewCount;
          
          if (reviewCount > 10) highVolumeSuppliers++;
          else if (reviewCount >= 5) mediumVolumeSuppliers++;
          else lowVolumeSuppliers++;
        } else {
          suppliersWithoutReviews++;
        }
      });

      return {
        totalReviews,
        averageReviewsPerSupplier: suppliersWithReviews > 0 ? Math.round(totalReviews / suppliersWithReviews) : 0,
        suppliersWithReviews,
        suppliersWithoutReviews,
        highVolumeSuppliers,
        mediumVolumeSuppliers,
        lowVolumeSuppliers
      };
    } catch (error) {
      log.error('Error getting review volume stats:', { data: error }, 'SupplierStatisticsService');
      return {
        totalReviews: 0,
        averageReviewsPerSupplier: 0,
        suppliersWithReviews: 0,
        suppliersWithoutReviews: 0,
        highVolumeSuppliers: 0,
        mediumVolumeSuppliers: 0,
        lowVolumeSuppliers: 0
      };
    }
  }

  /**
   * Get performance distribution statistics
   */
  static async getPerformanceDistribution(): Promise<Record<string, {
    count: number;
    averageRating: number;
    categories: string[];
  }>> {
    try {
      const suppliers = await SupplierCrudService.getAll();
      const performanceLevels = ['excellent', 'good', 'average', 'poor', 'terrible'];
      const distribution: Record<string, {
        count: number;
        averageRating: number;
        categories: string[];
      }> = {};

      // Initialize distribution
      performanceLevels.forEach(level => {
        distribution[level] = {
          count: 0,
          averageRating: 0,
          categories: []
        };
      });

      const levelData: Record<string, { total: number; categories: Set<string> }> = {};
      performanceLevels.forEach(level => {
        levelData[level] = { total: 0, categories: new Set() };
      });

      suppliers.forEach(supplier => {
        const rating = SupplierRatingManager.normalizeRating(supplier.rating);
        const overallRating = rating.overall || 0;
        
        let level: string;
        if (overallRating >= 90) level = 'excellent';
        else if (overallRating >= 70) level = 'good';
        else if (overallRating >= 50) level = 'average';
        else if (overallRating >= 30) level = 'poor';
        else level = 'terrible';

        distribution[level]!.count++;
        levelData[level]!.total += overallRating;

        supplier.categories?.forEach(category => {
          levelData[level]!.categories.add(category);
        });
      });

      // Calculate averages and convert categories
      Object.entries(levelData).forEach(([level, data]) => {
        if (distribution[level]!.count > 0) {
          distribution[level]!.averageRating = Math.round(data.total / distribution[level]!.count);
        }
        distribution[level]!.categories = Array.from(data.categories);
      });

      return distribution;
    } catch (error) {
      log.error('Error getting performance distribution:', { data: error }, 'SupplierStatisticsService');
      return {};
    }
  }
}