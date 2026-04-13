/**
 * Basic Supplier Statistics Calculator
 * Core statistical calculations and aggregations
 */

import { Supplier, SupplierStatus } from '@/types/supplier/base.types';
import { SupplierStatistics, StatisticsOptions } from './types';
import { log } from '@/lib/logger';

export class BasicStatsCalculator {
  /**
   * Calculate comprehensive supplier statistics
   */
  static async getStatistics(options?: StatisticsOptions): Promise<SupplierStatistics> {
    try {
      // Get all suppliers
      const supplierCrudService = await import('../supplier.crud');
      let suppliers = await supplierCrudService.SupplierCrudService.getAll();

      // Apply filters if provided
      suppliers = this.applyFilters(suppliers, options);

      const stats: SupplierStatistics = {
        total: suppliers.length,
        active: suppliers.filter(s => s.status === SupplierStatus.ACTIVE).length,
        inactive: suppliers.filter(s => s.status === SupplierStatus.INACTIVE).length,
        pending: suppliers.filter(s => s.status === SupplierStatus.PENDING).length,
        blacklisted: suppliers.filter(s => s.status === SupplierStatus.BLACKLISTED).length,
        preferred: suppliers.filter(s => s.isPreferred).length,
        averageRating: this.calculateAverageRating(suppliers),
        averagePerformance: this.calculateAveragePerformance(suppliers),
        categoryCounts: this.countByCategory(suppliers),
        topRated: this.getTopRatedSuppliers(suppliers, 10),
        recentlyAdded: this.getRecentlyAddedSuppliers(suppliers, 30),
        complianceStats: this.calculateComplianceStats(suppliers)
      };

      return stats;
    } catch (error) {
      log.error('Error generating supplier statistics:', { data: error }, 'basicStats');
      throw new Error(`Failed to generate statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Apply filters to supplier list
   */
  private static applyFilters(suppliers: Supplier[], options?: StatisticsOptions): Supplier[] {
    if (!options) return suppliers;

    let filtered = suppliers;

    // Include inactive filter
    if (!options.includeInactive) {
      filtered = filtered.filter(s => s.status !== SupplierStatus.INACTIVE);
    }

    // Category filter
    if (options.filterByCategory && options.filterByCategory.length > 0) {
      filtered = filtered.filter(s => 
        s.categories?.some(cat => options.filterByCategory!.includes(cat))
      );
    }

    // Business type filter
    if (options.filterByBusinessType && options.filterByBusinessType.length > 0) {
      filtered = filtered.filter(s => 
        s.businessType && options.filterByBusinessType!.includes(s.businessType)
      );
    }

    // Location filter
    if (options.filterByLocation) {
      const locationFilter = options.filterByLocation.toLowerCase();
      filtered = filtered.filter(s => {
        const address = s.addresses?.physical;
        if (!address) return false;
        
        return (
          address.city?.toLowerCase().includes(locationFilter) ||
          address.state?.toLowerCase().includes(locationFilter) ||
          address.country?.toLowerCase().includes(locationFilter)
        );
      });
    }

    // Date range filter
    if (options.dateRange) {
      filtered = filtered.filter(s => {
        const createdAt = s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt);
        return createdAt >= options.dateRange!.start && createdAt <= options.dateRange!.end;
      });
    }

    return filtered;
  }

  /**
   * Calculate average rating across suppliers
   */
  private static calculateAverageRating(suppliers: Supplier[]): number {
    const ratingsWithValues = suppliers
      .map(supplier => {
        if (typeof supplier.rating === 'number') {
          return supplier.rating;
        }
        if (supplier.rating && typeof supplier.rating === 'object') {
          return supplier.rating.overall || 0;
        }
        return 0;
      })
      .filter(rating => rating > 0);

    return ratingsWithValues.length > 0
      ? Number((ratingsWithValues.reduce((sum, rating) => sum + rating, 0) / ratingsWithValues.length).toFixed(2))
      : 0;
  }

  /**
   * Calculate average performance across suppliers
   */
  private static calculateAveragePerformance(suppliers: Supplier[]): number {
    const performanceScores = suppliers
      .map(supplier => (supplier.performance as { overallScore?: number } | undefined)?.overallScore || 0)
      .filter(score => score > 0);

    return performanceScores.length > 0
      ? Number((performanceScores.reduce((sum, score) => sum + score, 0) / performanceScores.length).toFixed(2))
      : 0;
  }

  /**
   * Count suppliers by category
   */
  private static countByCategory(suppliers: Supplier[]): Record<string, number> {
    const counts: Record<string, number> = {};

    suppliers.forEach(supplier => {
      if (supplier.categories && supplier.categories.length > 0) {
        supplier.categories.forEach(category => {
          counts[category] = (counts[category] || 0) + 1;
        });
      } else {
        counts['Uncategorized'] = (counts['Uncategorized'] || 0) + 1;
      }
    });

    return counts;
  }

  /**
   * Get top-rated suppliers
   */
  private static getTopRatedSuppliers(suppliers: Supplier[], count: number): Supplier[] {
    return suppliers
      .filter(supplier => {
        const rating = typeof supplier.rating === 'number' 
          ? supplier.rating 
          : supplier.rating?.overall || 0;
        return rating > 0;
      })
      .sort((a, b) => {
        const ratingA = typeof a.rating === 'number' ? a.rating : a.rating?.overall || 0;
        const ratingB = typeof b.rating === 'number' ? b.rating : b.rating?.overall || 0;
        return ratingB - ratingA;
      })
      .slice(0, count);
  }

  /**
   * Get recently added suppliers
   */
  private static getRecentlyAddedSuppliers(suppliers: Supplier[], daysBack: number): Supplier[] {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    return suppliers
      .filter(supplier => {
        if (!supplier.createdAt) return false;
        const createdAt = supplier.createdAt instanceof Date 
          ? supplier.createdAt 
          : new Date(supplier.createdAt);
        return createdAt >= cutoffDate;
      })
      .sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
        const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
        return dateB.getTime() - dateA.getTime();
      });
  }

  /**
   * Calculate compliance statistics
   */
  private static calculateComplianceStats(suppliers: Supplier[]): {
    compliant: number;
    nonCompliant: number;
    expiringSoon: number;
  } {
    let compliant = 0;
    let nonCompliant = 0;
    let expiringSoon = 0;

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));

    suppliers.forEach(supplier => {
      if (supplier.complianceStatus) {
        const compliance = supplier.complianceStatus as { complianceScore?: number; taxCompliant?: boolean; beeCompliant?: boolean; insuranceValid?: boolean };
        if ((compliance.complianceScore ?? 0) >= 80 || (compliance.taxCompliant && compliance.beeCompliant && compliance.insuranceValid)) {
          compliant++;
        } else {
          nonCompliant++;
        }

        // Check for documents expiring soon
        if (supplier.documents) {
          const hasExpiring = supplier.documents.some(doc => 
            doc.expiryDate && 
            doc.expiryDate <= thirtyDaysFromNow && 
            doc.expiryDate > now
          );
          if (hasExpiring) {
            expiringSoon++;
          }
        }
      } else {
        nonCompliant++;
      }
    });

    return { compliant, nonCompliant, expiringSoon };
  }

  /**
   * Get statistics summary for dashboard
   */
  static async getDashboardSummary(): Promise<{
    totalSuppliers: number;
    activeSuppliers: number;
    preferredSuppliers: number;
    averageRating: number;
    complianceRate: number;
    topCategories: Array<{ category: string; count: number }>;
  }> {
    try {
      const stats = await this.getStatistics();
      
      const complianceRate = stats.total > 0 
        ? (stats.complianceStats.compliant / stats.total) * 100 
        : 0;

      const topCategories = Object.entries(stats.categoryCounts)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        totalSuppliers: stats.total,
        activeSuppliers: stats.active,
        preferredSuppliers: stats.preferred,
        averageRating: stats.averageRating,
        complianceRate: Math.round(complianceRate),
        topCategories
      };
    } catch (error) {
      log.error('Error generating dashboard summary:', { data: error }, 'basicStats');
      return {
        totalSuppliers: 0,
        activeSuppliers: 0,
        preferredSuppliers: 0,
        averageRating: 0,
        complianceRate: 0,
        topCategories: []
      };
    }
  }
}