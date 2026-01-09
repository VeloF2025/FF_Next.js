/**
 * Supplier Rating Manager
 * Handle supplier rating updates and calculations
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { SupplierRating } from '@/types/supplier/base.types';
import { RatingUpdateData } from './types';
import { SupplierCrudService } from '../supplier.crud';
import { log } from '@/lib/logger';

export class SupplierRatingManager {
  /**
   * Update supplier rating with automatic overall calculation
   */
  static async updateRating(
    id: string,
    rating: RatingUpdateData,
    reviewerId?: string
  ): Promise<void> {
    try {
      const supplier = await SupplierCrudService.getById(id);

      const currentRating = this.normalizeRating(supplier.rating);
      const updatedRating = {
        ...currentRating,
        ...rating,
        lastReviewDate: new Date(),
        lastReviewedBy: reviewerId || 'current-user-id'
      };

      // Calculate overall rating from individual components
      updatedRating.overall = this.calculateOverallRating(updatedRating);

      // Update total reviews count if this is a new review
      if (rating.quality || rating.delivery || rating.pricing || rating.communication) {
        updatedRating.totalReviews = (updatedRating.totalReviews || 0) + 1;
      }

      await SupplierCrudService.update(id, {
        rating: updatedRating,
        updatedAt: new Date()
      } as never);
    } catch (error) {
      log.error(`Error updating supplier rating for ${id}:`, { data: error }, 'ratingManager');
      throw new Error(`Failed to update supplier rating: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Normalize rating data to handle legacy formats
   */
  static normalizeRating(rating: unknown): SupplierRating {
    if (typeof rating === 'number') {
      return {
        supplierId: '',
        userId: '',
        userName: '',
        rating: rating,
        date: new Date(),
        overall: rating,
        totalReviews: 0
      };
    }

    const ratingObj = rating as Record<string, unknown> || {};
    return {
      supplierId: (ratingObj.supplierId as string) || '',
      userId: (ratingObj.userId as string) || '',
      userName: (ratingObj.userName as string) || '',
      rating: (ratingObj.rating as number) || 0,
      date: (ratingObj.date as Date) || new Date(),
      overall: (ratingObj.overall as number) || 0,
      totalReviews: 0,
      quality: 0,
      delivery: 0,
      pricing: 0,
      communication: 0,
      flexibility: 0,
      ...ratingObj
    };
  }

  /**
   * Calculate overall rating from individual components
   */
  static calculateOverallRating(rating: SupplierRating): number {
    const ratingValues = [
      rating.quality,
      rating.delivery,
      rating.pricing,
      rating.communication,
      rating.flexibility
    ].filter(r => r && r > 0);

    if (ratingValues.length === 0) {
      return rating.overall || 0;
    }

    return Math.round(ratingValues.filter(v => v != null).reduce((a, b) => a + (b || 0), 0) / ratingValues.length);
  }

  /**
   * Calculate weighted overall rating
   */
  static calculateWeightedRating(
    rating: SupplierRating,
    weights: { quality?: number; delivery?: number; pricing?: number; communication?: number; flexibility?: number } = {}
  ): number {
    const defaultWeights = {
      quality: 0.25,
      delivery: 0.25,
      pricing: 0.2,
      communication: 0.15,
      flexibility: 0.15
    };

    const finalWeights = { ...defaultWeights, ...weights };
    let weightedSum = 0;
    let totalWeight = 0;

    if (rating.quality && rating.quality > 0) {
      weightedSum += rating.quality * finalWeights.quality!;
      totalWeight += finalWeights.quality!;
    }
    if (rating.delivery && rating.delivery > 0) {
      weightedSum += rating.delivery * finalWeights.delivery!;
      totalWeight += finalWeights.delivery!;
    }
    if (rating.pricing && rating.pricing > 0) {
      weightedSum += rating.pricing * finalWeights.pricing!;
      totalWeight += finalWeights.pricing!;
    }
    if (rating.communication && rating.communication > 0) {
      weightedSum += rating.communication * finalWeights.communication!;
      totalWeight += finalWeights.communication!;
    }
    if (rating.flexibility && rating.flexibility > 0) {
      weightedSum += rating.flexibility * finalWeights.flexibility!;
      totalWeight += finalWeights.flexibility!;
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : rating.overall || 0;
  }

  /**
   * Validate rating values
   */
  static validateRating(rating: RatingUpdateData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const ratingFields = ['overall', 'quality', 'delivery', 'pricing', 'communication', 'flexibility'];

    ratingFields.forEach(field => {
      const value = (rating as Record<string, unknown>)[field];
      if (value !== undefined && (typeof value !== 'number' || (value as number) < 0 || (value as number) > 100)) {
        errors.push(`${field} must be a number between 0 and 100`);
      }
    });

    if (rating.totalReviews !== undefined && (typeof rating.totalReviews !== 'number' || rating.totalReviews < 0)) {
      errors.push('totalReviews must be a non-negative number');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert rating to star rating (1-5 scale)
   */
  static toStarRating(rating: number): number {
    if (rating <= 0) return 0;
    if (rating <= 20) return 1;
    if (rating <= 40) return 2;
    if (rating <= 60) return 3;
    if (rating <= 80) return 4;
    return 5;
  }

  /**
   * Convert star rating to percentage rating (0-100 scale)
   */
  static fromStarRating(stars: number): number {
    if (stars <= 0) return 0;
    if (stars >= 5) return 100;
    return Math.round(stars * 20);
  }

  /**
   * Get rating category based on score
   */
  static getRatingCategory(rating: number): 'excellent' | 'good' | 'average' | 'poor' | 'unrated' {
    if (rating >= 90) return 'excellent';
    if (rating >= 80) return 'good';
    if (rating >= 60) return 'average';
    if (rating > 0) return 'poor';
    return 'unrated';
  }

  /**
   * Calculate rating improvement needed to reach target
   */
  static calculateImprovementNeeded(currentRating: number, targetRating: number): {
    improvementNeeded: number;
    improvementPercentage: number;
    category: string;
  } {
    const improvementNeeded = Math.max(0, targetRating - currentRating);
    const improvementPercentage = currentRating > 0 ? (improvementNeeded / currentRating) * 100 : 0;

    let category = 'none';
    if (improvementNeeded > 20) category = 'major';
    else if (improvementNeeded > 10) category = 'moderate';
    else if (improvementNeeded > 5) category = 'minor';

    return {
      improvementNeeded,
      improvementPercentage: Math.round(improvementPercentage),
      category
    };
  }
}
