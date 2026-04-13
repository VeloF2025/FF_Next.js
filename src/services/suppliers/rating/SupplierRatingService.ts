/**
 * Supplier Rating Service
 * Handles top-rated suppliers and supplier comparisons
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { Supplier } from '@/types/supplier/base.types';
import { SupplierComparison } from './types';
import { SupplierCrudService } from '../supplier.crud';
import { SupplierRatingManager } from './ratingManager';
import { log } from '@/lib/logger';

export class SupplierRatingService {
  /**
   * Get top-rated suppliers
   */
  static async getTopRated(
    limit: number = 10,
    category?: string
  ): Promise<Supplier[]> {
    try {
      let suppliers = await SupplierCrudService.getAll();

      // Filter by status
      suppliers = suppliers.filter(s => s.status === 'active');

      // Filter by category if specified
      if (category) {
        suppliers = suppliers.filter(s =>
          s.categories && s.categories.includes(category as unknown as import('@/types/supplier/common.types').ProductCategory)
        );
      }

      // Filter suppliers with reviews and sort by rating
      return suppliers
        .filter(supplier => {
          const rating = SupplierRatingManager.normalizeRating(supplier.rating);
          return rating.totalReviews && rating.totalReviews > 0;
        })
        .sort((a, b) => {
          const aRating = SupplierRatingManager.normalizeRating(a.rating).overall || 0;
          const bRating = SupplierRatingManager.normalizeRating(b.rating).overall || 0;
          return bRating - aRating;
        })
        .slice(0, limit);
    } catch (error) {
      log.error('Error fetching top-rated suppliers:', { data: error }, 'SupplierRatingService');
      throw new Error(`Failed to fetch top-rated suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Compare suppliers by ratings
   */
  static async compareSuppliers(
    supplierIds: string[]
  ): Promise<SupplierComparison[]> {
    try {
      const comparisons = [];

      for (const id of supplierIds) {
        const supplier = await SupplierCrudService.getById(id);
        const ratings = SupplierRatingManager.normalizeRating(supplier.rating);

        comparisons.push({
          supplier,
          ratings,
          ...(supplier.performance && { performance: supplier.performance })
        });
      }

      return comparisons;
    } catch (error) {
      log.error('Error comparing suppliers:', { data: error }, 'SupplierRatingService');
      throw new Error(`Failed to compare suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get suppliers by rating range
   */
  static async getSuppliersByRatingRange(
    minRating: number,
    maxRating: number = 100,
    limit: number = 50
  ): Promise<Supplier[]> {
    try {
      const suppliers = await SupplierCrudService.getAll();

      return suppliers
        .filter(supplier => {
          const rating = SupplierRatingManager.normalizeRating(supplier.rating);
          const overallRating = rating.overall || 0;
          return overallRating >= minRating && overallRating <= maxRating;
        })
        .sort((a, b) => {
          const aRating = SupplierRatingManager.normalizeRating(a.rating).overall || 0;
          const bRating = SupplierRatingManager.normalizeRating(b.rating).overall || 0;
          return bRating - aRating;
        })
        .slice(0, limit);
    } catch (error) {
      log.error('Error getting suppliers by rating range:', { data: error }, 'SupplierRatingService');
      throw new Error(`Failed to get suppliers by rating range: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get suppliers with most reviews
   */
  static async getMostReviewedSuppliers(limit: number = 10): Promise<Supplier[]> {
    try {
      const suppliers = await SupplierCrudService.getAll();

      return suppliers
        .filter(supplier => {
          const rating = SupplierRatingManager.normalizeRating(supplier.rating);
          return rating.totalReviews && rating.totalReviews > 0;
        })
        .sort((a, b) => {
          const aReviews = SupplierRatingManager.normalizeRating(a.rating).totalReviews || 0;
          const bReviews = SupplierRatingManager.normalizeRating(b.rating).totalReviews || 0;
          return bReviews - aReviews;
        })
        .slice(0, limit);
    } catch (error) {
      log.error('Error getting most reviewed suppliers:', { data: error }, 'SupplierRatingService');
      throw new Error(`Failed to get most reviewed suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get recently rated suppliers
   */
  static async getRecentlyRatedSuppliers(
    days: number = 30,
    limit: number = 20
  ): Promise<Supplier[]> {
    try {
      // In production, this would filter by recent rating dates
      // For now, return most recently updated suppliers
      const suppliers = await SupplierCrudService.getAll();
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      return suppliers
        .filter(supplier => {
          const updatedAt = supplier.updatedAt;
          if (!updatedAt) return false;
          const updateDate = typeof updatedAt === 'string' ? new Date(updatedAt) : updatedAt;
          return updateDate >= cutoffDate;
        })
        .sort((a, b) => {
          const aDate = a.updatedAt ? (typeof a.updatedAt === 'string' ? new Date(a.updatedAt) : a.updatedAt) : new Date(0);
          const bDate = b.updatedAt ? (typeof b.updatedAt === 'string' ? new Date(b.updatedAt) : b.updatedAt) : new Date(0);
          return bDate.getTime() - aDate.getTime();
        })
        .slice(0, limit);
    } catch (error) {
      log.error('Error getting recently rated suppliers:', { data: error }, 'SupplierRatingService');
      throw new Error(`Failed to get recently rated suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
