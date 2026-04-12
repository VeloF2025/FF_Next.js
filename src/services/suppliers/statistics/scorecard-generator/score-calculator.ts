/**
 * Score Calculator
 * Core scoring and rating calculation logic
 */

import { Supplier } from '@/types/supplier/base.types';
import type { ScorecardMetrics } from './scorecard-types';

/**
 * Extended performance shape used by scorecard (subset of fields queried from supplier data).
 * Supplier.performance is typed as SupplierPerformance but may carry additional runtime fields.
 */
interface PerformanceExtended {
  overallScore?: number;
  qualityScore?: number;
  onTimeDelivery?: number;
  responseTime?: number;
  issueResolution?: number;
}

/** Extended rating shape that may include a breakdown object */
interface RatingWithBreakdown {
  overall?: number;
  totalReviews?: number;
  breakdown?: {
    quality?: number;
    delivery?: number;
    communication?: number;
    pricing?: number;
    reliability?: number;
  };
}

export class ScorecardScoreCalculator {
  /**
   * Calculate overall supplier score
   */
  static calculateOverallScore(supplier: Supplier): number {
    let totalScore = 0;
    let weightedSum = 0;

    // Rating score (30% weight)
    const ratingScore = this.getSupplierRating(supplier);
    if (ratingScore > 0) {
      totalScore += (ratingScore / 5) * 30;
      weightedSum += 30;
    }

    // Performance score (25% weight)
    const performanceScore = (supplier.performance as PerformanceExtended | undefined)?.overallScore ?? 0;
    if (performanceScore > 0) {
      totalScore += (performanceScore / 100) * 25;
      weightedSum += 25;
    }

    // Compliance score (25% weight)
    const compliance = supplier.complianceStatus;
    let complianceScore = 0;
    if (compliance) {
      // Calculate compliance score from available compliance data
      let factors = 0;
      let tempScore = 0;
      
      if (compliance.taxCompliant) {
        tempScore += 30;
        factors++;
      }
      if (compliance.beeCompliant) {
        tempScore += 25;
        factors++;
      }
      if (compliance.isoCompliant) {
        tempScore += 25;
        factors++;
      }
      if (compliance.documentsVerified) {
        tempScore += 20;
        factors++;
      }
      
      complianceScore = factors > 0 ? tempScore : 0;
    }
    
    if (complianceScore > 0) {
      totalScore += (complianceScore / 100) * 25;
      weightedSum += 25;
    }

    // Preferred status bonus (10% weight)
    if (supplier.isPreferred) {
      totalScore += 10;
      weightedSum += 10;
    }

    // Response time score (10% weight) - simplified
    const responseScore = this.calculateResponseScore(supplier);
    totalScore += (responseScore / 100) * 10;
    weightedSum += 10;

    return weightedSum > 0 ? Math.round((totalScore / weightedSum) * 100) : 0;
  }

  /**
   * Extract detailed ratings
   */
  static extractRatings(supplier: Supplier): {
    quality: number;
    delivery: number;
    communication: number;
    pricing: number;
    reliability: number;
  } {
    const rating = supplier.rating;
    
    if (rating && typeof rating === 'object' && 'breakdown' in rating) {
      const breakdown = (rating as RatingWithBreakdown).breakdown ?? {};
      return {
        quality: breakdown.quality || 0,
        delivery: breakdown.delivery || 0,
        communication: breakdown.communication || 0,
        pricing: breakdown.pricing || 0,
        reliability: breakdown.reliability || 0
      };
    }

    // Default values if detailed breakdown not available
    const overallRating = this.getSupplierRating(supplier);
    return {
      quality: overallRating,
      delivery: overallRating,
      communication: overallRating,
      pricing: overallRating,
      reliability: overallRating
    };
  }

  /**
   * Extract performance metrics
   */
  static extractPerformance(supplier: Supplier): {
    onTimeDelivery: number;
    qualityScore: number;
    responseTime: number;
    issueResolution: number;
  } {
    const performance = supplier.performance as PerformanceExtended | undefined;

    return {
      onTimeDelivery: performance?.onTimeDelivery ?? 0,
      qualityScore: performance?.qualityScore ?? 0,
      responseTime: performance?.responseTime ?? 0,
      issueResolution: performance?.issueResolution ?? 0
    };
  }

  /**
   * Calculate response score (simplified)
   */
  static calculateResponseScore(supplier: Supplier): number {
    // Simplified calculation based on available data
    if (supplier.primaryContact?.email) {
      return 80; // Has contact info
    }
    return 40; // Limited contact info
  }

  /**
   * Get supplier rating
   */
  static getSupplierRating(supplier: Supplier): number {
    if (typeof supplier.rating === 'number') {
      return supplier.rating;
    }
    if (supplier.rating && typeof supplier.rating === 'object') {
      return supplier.rating.overall || 0;
    }
    return 0;
  }

  /**
   * Calculate percentile ranking
   */
  static calculatePercentile(value: number, sortedArray: number[]): number {
    if (sortedArray.length === 0) return 50;
    
    const index = sortedArray.findIndex(v => v >= value);
    if (index === -1) return 100; // Higher than all values
    
    return (index / sortedArray.length) * 100;
  }

  /**
   * Get complete scorecard metrics
   */
  static getScorecardMetrics(supplier: Supplier): ScorecardMetrics {
    return {
      overallScore: this.calculateOverallScore(supplier),
      ratings: this.extractRatings(supplier),
      performance: this.extractPerformance(supplier)
    };
  }
}