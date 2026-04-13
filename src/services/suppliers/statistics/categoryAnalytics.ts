/**
 * Category Analytics Service
 * Analyze supplier performance and distribution by category
 */

import { Supplier, SupplierStatus } from '@/types/supplier/base.types';
import { CategoryAnalytics } from './types';
import { log } from '@/lib/logger';

export class CategoryAnalyticsService {
  /**
   * Get comprehensive analytics by category
   */
  static async getCategoryAnalytics(): Promise<CategoryAnalytics[]> {
    try {
      // Get all active suppliers
      const supplierCrudService = await import('../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      const activeSuppliers = suppliers.filter(s => s.status === SupplierStatus.ACTIVE);

      // Get all unique categories
      const categories = this.getAllCategories(activeSuppliers);

      // Generate analytics for each category
      const analytics = categories.map(category => 
        this.generateCategoryAnalytics(category, activeSuppliers)
      );

      // Sort by total suppliers descending
      analytics.sort((a, b) => b.totalSuppliers - a.totalSuppliers);

      return analytics;
    } catch (error) {
      log.error('Error generating category analytics:', { data: error }, 'categoryAnalytics');
      throw new Error(`Failed to generate category analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get analytics for a specific category
   */
  static async getCategoryAnalytics_Single(category: string): Promise<CategoryAnalytics | null> {
    try {
      const supplierCrudService = await import('../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      const activeSuppliers = suppliers.filter(s => s.status === SupplierStatus.ACTIVE);

      const categorySuppliers = activeSuppliers.filter(s => 
        s.categories?.some(cat => cat.toString() === category.toString())
      );

      if (categorySuppliers.length === 0) {
        return null;
      }

      return this.generateCategoryAnalytics(category, activeSuppliers);
    } catch (error) {
      log.error(`Error generating analytics for category ${category}:`, { data: error }, 'categoryAnalytics');
      return null;
    }
  }

  /**
   * Get category performance comparison
   */
  static async getCategoryPerformanceComparison(): Promise<Array<{
    category: string;
    averageRating: number;
    averagePerformance: number;
    supplierCount: number;
    preferredPercentage: number;
    rank: number;
  }>> {
    try {
      const analytics = await this.getCategoryAnalytics();

      return analytics
        .map((cat, index) => ({
          category: cat.category,
          averageRating: cat.averageRating,
          averagePerformance: cat.averagePerformance,
          supplierCount: cat.totalSuppliers,
          preferredPercentage: cat.totalSuppliers > 0 
            ? (cat.preferredSuppliers / cat.totalSuppliers) * 100 
            : 0,
          rank: index + 1
        }))
        .sort((a, b) => b.averageRating - a.averageRating);
    } catch (error) {
      log.error('Error generating category performance comparison:', { data: error }, 'categoryAnalytics');
      return [];
    }
  }

  /**
   * Get category trends over time
   */
  static async getCategoryTrends(months: number = 6): Promise<Array<{
    category: string;
    monthlyData: Array<{
      month: string;
      year: number;
      supplierCount: number;
      newSuppliers: number;
      averageRating: number;
    }>;
  }>> {
    try {
      const supplierCrudService = await import('../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      const categories = this.getAllCategories(suppliers);

      const trends = categories.map(category => ({
        category,
        monthlyData: this.calculateCategoryTrends(category, suppliers, months)
      }));

      return trends.filter(trend => trend.monthlyData.length > 0);
    } catch (error) {
      log.error('Error generating category trends:', { data: error }, 'categoryAnalytics');
      return [];
    }
  }

  /**
   * Get all unique categories from suppliers
   */
  private static getAllCategories(suppliers: Supplier[]): string[] {
    const categorySet = new Set<string>();
    
    suppliers.forEach(supplier => {
      if (supplier.categories && supplier.categories.length > 0) {
        supplier.categories.forEach(category => categorySet.add(category));
      }
    });

    return Array.from(categorySet).sort();
  }

  /**
   * Generate analytics for a specific category
   */
  private static generateCategoryAnalytics(category: string, allSuppliers: Supplier[]): CategoryAnalytics {
    const categorySuppliers = allSuppliers.filter(s => 
      s.categories?.some(cat => cat.toString() === category.toString())
    );

    const activeSuppliers = categorySuppliers.filter(s => 
      s.status === SupplierStatus.ACTIVE
    );

    const preferredSuppliers = categorySuppliers.filter(s => s.isPreferred);

    const averageRating = this.calculateAverageRating(categorySuppliers);
    const averagePerformance = this.calculateAveragePerformance(categorySuppliers);

    const topSuppliers = categorySuppliers
      .map(supplier => ({
        id: supplier.id,
        name: supplier.companyName || supplier.name || 'Unknown',
        rating: this.getSupplierRating(supplier),
        isPreferred: supplier.isPreferred || false
      }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5);

    return {
      category,
      totalSuppliers: categorySuppliers.length,
      activeSuppliers: activeSuppliers.length,
      preferredSuppliers: preferredSuppliers.length,
      averageRating,
      averagePerformance,
      topSuppliers
    };
  }

  /**
   * Calculate category trends over time
   */
  private static calculateCategoryTrends(
    category: string, 
    suppliers: Supplier[], 
    months: number
  ): Array<{
    month: string;
    year: number;
    supplierCount: number;
    newSuppliers: number;
    averageRating: number;
  }> {
    const monthlyData: Array<{
      month: string;
      year: number;
      supplierCount: number;
      newSuppliers: number;
      averageRating: number;
    }> = [];

    const now = new Date();
    
    for (let i = months - 1; i >= 0; i--) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
      
      const categorySuppliers = suppliers.filter(s => 
        s.categories?.some(cat => cat.toString() === category.toString()) && 
        s.createdAt && 
        new Date(s.createdAt) <= monthEnd
      );

      const newSuppliers = suppliers.filter(s => {
        if (!s.categories?.some(cat => cat.toString() === category.toString()) || !s.createdAt) return false;
        const createdDate = new Date(s.createdAt);
        return createdDate.getFullYear() === targetDate.getFullYear() &&
               createdDate.getMonth() === targetDate.getMonth();
      });

      monthlyData.push({
        month: targetDate.toLocaleString('default', { month: 'long' }),
        year: targetDate.getFullYear(),
        supplierCount: categorySuppliers.length,
        newSuppliers: newSuppliers.length,
        averageRating: this.calculateAverageRating(categorySuppliers)
      });
    }

    return monthlyData;
  }

  /**
   * Calculate average rating for suppliers
   */
  private static calculateAverageRating(suppliers: Supplier[]): number {
    const ratings = suppliers
      .map(s => this.getSupplierRating(s))
      .filter(rating => rating > 0);

    return ratings.length > 0 
      ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2))
      : 0;
  }

  /**
   * Calculate average performance for suppliers
   */
  private static calculateAveragePerformance(suppliers: Supplier[]): number {
    const performances = suppliers
      .map(s => (s.performance as { overallScore?: number } | undefined)?.overallScore || 0)
      .filter(score => score > 0);

    return performances.length > 0 
      ? Number((performances.reduce((sum, score) => sum + score, 0) / performances.length).toFixed(2))
      : 0;
  }

  /**
   * Get supplier rating (normalize different formats)
   */
  private static getSupplierRating(supplier: Supplier): number {
    if (typeof supplier.rating === 'number') {
      return supplier.rating;
    }
    if (supplier.rating && typeof supplier.rating === 'object') {
      return supplier.rating.overall || 0;
    }
    return 0;
  }

  /**
   * Get category distribution summary
   */
  static async getCategoryDistribution(): Promise<Array<{
    category: string;
    count: number;
    percentage: number;
    averageRating: number;
  }>> {
    try {
      const supplierCrudService = await import('../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      const categoryStats = this.getAllCategories(suppliers).map(category => {
        const categorySuppliers = suppliers.filter(s => s.categories?.some(cat => cat.toString() === category.toString()));
        return {
          category,
          count: categorySuppliers.length,
          percentage: suppliers.length > 0 ? (categorySuppliers.length / suppliers.length) * 100 : 0,
          averageRating: this.calculateAverageRating(categorySuppliers)
        };
      });

      return categoryStats
        .sort((a, b) => b.count - a.count)
        .map(stat => ({
          ...stat,
          percentage: Math.round(stat.percentage * 100) / 100
        }));
    } catch (error) {
      log.error('Error getting category distribution:', { data: error }, 'categoryAnalytics');
      return [];
    }
  }
}