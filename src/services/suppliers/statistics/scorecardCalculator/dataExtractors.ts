/**
 * Data Extractors
 * Handles extraction and validation of supplier data components
 */

import { Supplier } from '@/types/supplier/base.types';
import {
  SupplierRatings,
  SupplierPerformance,
  SupplierCompliance,
  COMPLIANCE_STATUS_THRESHOLDS,
  isValidPerformance,
  isValidCompliance
} from '../scorecardTypes';
import { ValidationUtils } from './validationUtils';

/** Extended rating shape that may include a breakdown object */
interface RatingWithBreakdown {
  overall?: number;
  breakdown?: {
    quality?: number;
    delivery?: number;
    communication?: number;
    pricing?: number;
    reliability?: number;
  };
}

export class DataExtractors {
  /**
   * Extract detailed ratings breakdown
   */
  static extractRatings(supplier: Supplier): SupplierRatings {
    const rating = supplier.rating;
    
    if (rating && typeof rating === 'object' && 'breakdown' in rating) {
      const breakdown = (rating as RatingWithBreakdown).breakdown ?? {};
      return {
        quality: ValidationUtils.validateRatingValue(breakdown.quality),
        delivery: ValidationUtils.validateRatingValue(breakdown.delivery),
        communication: ValidationUtils.validateRatingValue(breakdown.communication),
        pricing: ValidationUtils.validateRatingValue(breakdown.pricing),
        reliability: ValidationUtils.validateRatingValue(breakdown.reliability)
      };
    }

    // Default values if detailed breakdown not available
    const overallRating = this.extractSupplierRating(supplier);
    return {
      quality: overallRating,
      delivery: overallRating,
      communication: overallRating,
      pricing: overallRating,
      reliability: overallRating
    };
  }

  /**
   * Extract performance metrics with validation
   */
  static extractPerformance(supplier: Supplier): SupplierPerformance {
    const raw = supplier.performance;

    if (!isValidPerformance(raw)) {
      return {
        onTimeDelivery: 0,
        qualityScore: 0,
        responseTime: 0,
        issueResolution: 0
      };
    }

    // Cast to the scorecard SupplierPerformance shape (validated above)
    const performance = raw as unknown as SupplierPerformance;
    return {
      onTimeDelivery: ValidationUtils.validatePercentageValue(performance.onTimeDelivery),
      qualityScore: ValidationUtils.validatePercentageValue(performance.qualityScore),
      responseTime: ValidationUtils.validatePercentageValue(performance.responseTime),
      issueResolution: ValidationUtils.validatePercentageValue(performance.issueResolution)
    };
  }

  /**
   * Extract compliance information with validation
   */
  static extractCompliance(supplier: Supplier): SupplierCompliance {
    const compliance = supplier.complianceStatus;
    
    if (!isValidCompliance(compliance)) {
      return {
        score: 0,
        status: this.determineComplianceStatus(0),
        lastCheck: new Date()
      };
    }
    
    // Calculate compliance score based on available properties
    const complianceFlags = [
      compliance?.taxCompliant,
      compliance?.beeCompliant,
      compliance?.isoCompliant,
      compliance?.documentsVerified,
      compliance?.insuranceValid
    ].filter(flag => flag !== undefined);
    
    const trueFlags = complianceFlags.filter(flag => flag === true).length;
    const calculatedScore = complianceFlags.length > 0 ? (trueFlags / complianceFlags.length) * 100 : 0;
    const score = ValidationUtils.validatePercentageValue(calculatedScore);
    
    return {
      score,
      status: this.determineComplianceStatus(score),
      lastCheck: compliance?.lastAuditDate ? new Date(compliance.lastAuditDate) : new Date()
    };
  }

  /**
   * Extract supplier rating value
   */
  static extractSupplierRating(supplier: Supplier): number {
    if (!supplier.rating) return 0;
    
    if (typeof supplier.rating === 'number') {
      return ValidationUtils.validateRatingValue(supplier.rating);
    }
    
    if (typeof supplier.rating === 'object' && 'overall' in supplier.rating) {
      return ValidationUtils.validateRatingValue(supplier.rating.overall);
    }
    
    return 0;
  }

  /**
   * Extract performance score from supplier data
   */
  static extractPerformanceScore(supplier: Supplier): number {
    const raw = supplier.performance;

    if (!isValidPerformance(raw)) {
      return 0;
    }

    // Cast to scorecard shape; isValidPerformance guards 'overallScore' presence
    const performance = raw as unknown as { overallScore: number };
    return ValidationUtils.validatePercentageValue(performance.overallScore);
  }

  /**
   * Extract compliance score from supplier data
   */
  static extractComplianceScore(supplier: Supplier): number {
    const compliance = supplier.complianceStatus;
    
    if (!isValidCompliance(compliance)) {
      return 0;
    }
    
    // Calculate compliance score based on available properties
    const complianceFlags = [
      compliance?.taxCompliant,
      compliance?.beeCompliant,
      compliance?.isoCompliant,
      compliance?.documentsVerified,
      compliance?.insuranceValid
    ].filter(flag => flag !== undefined);
    
    const trueFlags = complianceFlags.filter(flag => flag === true).length;
    const calculatedScore = complianceFlags.length > 0 ? (trueFlags / complianceFlags.length) * 100 : 0;
    return ValidationUtils.validatePercentageValue(calculatedScore);
  }

  /**
   * Determine compliance status string based on score
   */
  static determineComplianceStatus(score: number): string {
    if (score >= COMPLIANCE_STATUS_THRESHOLDS.excellent) return 'Excellent';
    if (score >= COMPLIANCE_STATUS_THRESHOLDS.good) return 'Good';
    if (score >= COMPLIANCE_STATUS_THRESHOLDS.acceptable) return 'Acceptable';
    if (score >= COMPLIANCE_STATUS_THRESHOLDS.needsImprovement) return 'Needs Improvement';
    return 'Critical';
  }

  /**
   * Calculate rating category average
   */
  static calculateRatingCategoryAverage(ratings: SupplierRatings): number {
    const values = Object.values(ratings).filter(rating => rating > 0);
    return values.length > 0 ? values.reduce((sum, rating) => sum + rating, 0) / values.length : 0;
  }

  /**
   * Calculate performance category average
   */
  static calculatePerformanceCategoryAverage(performance: SupplierPerformance): number {
    const values = Object.values(performance).filter(perf => perf > 0);
    return values.length > 0 ? values.reduce((sum, perf) => sum + perf, 0) / values.length : 0;
  }
}