/**
 * Score Calculator Module
 * Handles all score calculation logic for supplier scorecards
 */

import { Supplier, ComplianceStatus } from '@/types/supplier/base.types';
import {
  ScoreWeights,
  DEFAULT_SCORE_WEIGHTS,
  RatingBreakdown,
  PerformanceMetrics,
  ComplianceInfo,
  COMPLIANCE_THRESHOLDS
} from './types';
import { SupplierUtils } from './utils';

export class ScoreCalculator {
  /**
   * Calculate overall supplier score
   */
  static calculateOverallScore(
    supplier: Supplier, 
    weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS
  ): number {
    let totalScore = 0;
    let weightedSum = 0;

    // Rating score
    const ratingScore = SupplierUtils.getSupplierRating(supplier);
    if (ratingScore > 0) {
      totalScore += (ratingScore / 5) * weights.rating;
      weightedSum += weights.rating;
    }

    // Performance score
    const performanceScore = supplier.performance?.overallScore || 0;
    if (performanceScore > 0) {
      totalScore += (performanceScore / 100) * weights.performance;
      weightedSum += weights.performance;
    }

    // Compliance score
    const complianceScore = this.calculateBasicComplianceScore(supplier.complianceStatus);
    if (complianceScore > 0) {
      totalScore += (complianceScore / 100) * weights.compliance;
      weightedSum += weights.compliance;
    }

    // Preferred status bonus
    if (supplier.isPreferred) {
      totalScore += weights.preferred;
      weightedSum += weights.preferred;
    }

    // Response time score
    const responseScore = this.calculateResponseScore(supplier);
    totalScore += (responseScore / 100) * weights.response;
    weightedSum += weights.response;

    return weightedSum > 0 ? Math.round((totalScore / weightedSum) * 100) : 0;
  }

  /**
   * Extract detailed ratings breakdown
   */
  static extractRatings(supplier: Supplier): RatingBreakdown {
    const rating = supplier.rating;
    
    if (rating && typeof rating === 'object' && 'breakdown' in rating) {
      const breakdown = (rating as { overall: number; breakdown?: Partial<{ quality: number; delivery: number; communication: number; pricing: number; reliability: number }> }).breakdown || {};
      return {
        quality: breakdown.quality || 0,
        delivery: breakdown.delivery || 0,
        communication: breakdown.communication || 0,
        pricing: breakdown.pricing || 0,
        reliability: breakdown.reliability || 0
      };
    }

    // Default values if detailed breakdown not available
    const overallRating = SupplierUtils.getSupplierRating(supplier);
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
  static extractPerformance(supplier: Supplier): PerformanceMetrics {
    const performance = supplier.performance;

    return {
      onTimeDelivery: performance?.metrics?.onTimeDeliveries ?? 0,
      qualityScore: performance?.qualityScore || 0,
      responseTime: performance?.metrics?.averageResponseTime ?? 0,
      issueResolution: performance?.serviceScore ?? 0
    };
  }

  /**
   * Extract compliance information
   */
  static extractCompliance(supplier: Supplier): ComplianceInfo {
    const compliance = supplier.complianceStatus;
    
    const complianceScore = this.calculateBasicComplianceScore(compliance);
    return {
      score: complianceScore,
      status: this.determineComplianceStatus(complianceScore),
      lastCheck: compliance?.lastAuditDate ? new Date(compliance.lastAuditDate) : new Date()
    };
  }

  /**
   * Calculate response score (simplified)
   */
  private static calculateResponseScore(supplier: Supplier): number {
    // Simplified calculation based on available data
    if (supplier.primaryContact?.email) {
      return 80; // Has contact info
    }
    return 40; // Limited contact info
  }

  /**
   * Determine compliance status string
   */
  private static determineComplianceStatus(score: number): string {
    if (score >= COMPLIANCE_THRESHOLDS.EXCELLENT) return 'Excellent';
    if (score >= COMPLIANCE_THRESHOLDS.GOOD) return 'Good';
    if (score >= COMPLIANCE_THRESHOLDS.ACCEPTABLE) return 'Acceptable';
    if (score >= COMPLIANCE_THRESHOLDS.NEEDS_IMPROVEMENT) return 'Needs Improvement';
    return 'Critical';
  }

  /**
   * Validate score calculation inputs
   */
  static validateSupplierData(supplier: Supplier): {
    isValid: boolean;
    issues: string[];
    completeness: number;
  } {
    const issues: string[] = [];
    let completenessScore = 0;
    const totalChecks = 8;

    // Check basic information
    if (!supplier.companyName && !supplier.name) {
      issues.push('Missing supplier name');
    } else {
      completenessScore++;
    }

    // Check rating data
    if (SupplierUtils.getSupplierRating(supplier) > 0) {
      completenessScore++;
    } else {
      issues.push('Missing rating data');
    }

    // Check performance data
    if (supplier.performance) {
      completenessScore++;
    } else {
      issues.push('Missing performance data');
    }

    // Check compliance data
    if (supplier.complianceStatus) {
      completenessScore++;
    } else {
      issues.push('Missing compliance data');
    }

    // Check contact information
    if (supplier.primaryContact?.email) {
      completenessScore++;
    } else {
      issues.push('Missing primary contact email');
    }

    // Check categories
    if (supplier.categories && supplier.categories.length > 0) {
      completenessScore++;
    } else {
      issues.push('Missing category information');
    }

    // Check business information
    if (supplier.businessType) {
      completenessScore++;
    } else {
      issues.push('Missing business type');
    }

    // Check location
    if (supplier.addresses?.physical) {
      completenessScore++;
    } else {
      issues.push('Missing address information');
    }

    const completeness = (completenessScore / totalChecks) * 100;
    const isValid = completeness >= 50; // Minimum 50% data completeness

    return {
      isValid,
      issues,
      completeness: Math.round(completeness)
    };
  }

  /**
   * Calculate weighted score with custom weights
   */
  static calculateWeightedScore(
    scores: Record<string, number>,
    weights: Record<string, number>
  ): number {
    let totalScore = 0;
    let totalWeight = 0;

    for (const [key, score] of Object.entries(scores)) {
      const weight = weights[key] || 0;
      if (score > 0 && weight > 0) {
        totalScore += score * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Calculate basic compliance score from available data
   */
  private static calculateBasicComplianceScore(compliance: ComplianceStatus | undefined): number {
    if (!compliance) return 0;
    
    let score = 0;
    let factors = 0;
    
    if (compliance.taxCompliant) { score += 30; factors++; }
    if (compliance.beeCompliant) { score += 25; factors++; }
    if (compliance.isoCompliant) { score += 25; factors++; }
    if (compliance.documentsVerified) { score += 20; factors++; }
    
    return factors > 0 ? score : 0;
  }
}