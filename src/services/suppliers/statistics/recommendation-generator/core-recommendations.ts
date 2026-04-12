/**
 * Core Recommendations
 * Core recommendation generation logic
 */

import { Supplier } from '@/types/supplier/base.types';
import type {
  ComplianceInfo
} from './recommendation-types';

/** Performance metrics shape used for recommendation generation */
export interface SupplierPerformanceInput {
  onTimeDelivery: number;
  qualityScore: number;
  responseTime: number;
  issueResolution: number;
}

export class CoreRecommendationEngine {
  /**
   * Generate comprehensive improvement recommendations
   */
  static generateRecommendations(
    supplier: Supplier,
    overallScore: number,
    compliance: ComplianceInfo,
    performanceMetrics?: SupplierPerformanceInput
  ): string[] {
    const recommendations: string[] = [];

    // Score-based recommendations
    if (overallScore < 60) { // RECOMMENDATION_THRESHOLDS.CRITICAL_SCORE
      recommendations.push('Critical improvement needed across all performance areas');
      recommendations.push('Schedule immediate supplier development meeting');
    } else if (overallScore < 80) { // RECOMMENDATION_THRESHOLDS.IMPROVEMENT_SCORE
      recommendations.push('Focus on key performance improvement areas');
    }

    // Rating-based recommendations
    const rating = this.getSupplierRating(supplier);
    if (rating < 3.5) { // RECOMMENDATION_THRESHOLDS.MIN_RATING
      recommendations.push('Improve service quality and customer satisfaction');
      if (rating < 2.5) {
        recommendations.push('Consider supplier replacement due to consistently poor performance');
      }
    }

    // Compliance recommendations
    if (compliance.score < 80) { // RECOMMENDATION_THRESHOLDS.MIN_COMPLIANCE
      recommendations.push('Update compliance documentation and certifications');
      if (compliance.score < 60) {
        recommendations.push('Urgent compliance review required - risk of non-compliance');
      }
    }

    // Performance-specific recommendations
    if (performanceMetrics) {
      const performanceRecs = this.generatePerformanceRecommendations(
        supplier,
        performanceMetrics
      );
      recommendations.push(...performanceRecs);
    }

    // Communication recommendations
    const communicationRecs = this.generateCommunicationRecommendations(supplier);
    recommendations.push(...communicationRecs);

    // Business development recommendations
    const businessRecs = this.generateBusinessRecommendations(
      supplier,
      overallScore
    );
    recommendations.push(...businessRecs);

    // Default recommendation if none identified
    if (recommendations.length === 0) {
      recommendations.push('Maintain current excellent performance standards');
    }

    return recommendations.slice(0, 8); // Limit to top 8 recommendations
  }

  /**
   * Generate performance-specific recommendations
   */
  static generatePerformanceRecommendations(
    supplier: Supplier,
    performance: SupplierPerformanceInput
  ): string[] {
    const recommendations: string[] = [];

    if (performance.onTimeDelivery < 90) { // RECOMMENDATION_THRESHOLDS.MIN_DELIVERY
      recommendations.push(`${supplier.name}: Improve delivery time consistency`);
      if (performance.onTimeDelivery < 75) {
        recommendations.push(`${supplier.name}: Implement delivery tracking and logistics optimization`);
      }
    }

    if (performance.qualityScore < 85) { // RECOMMENDATION_THRESHOLDS.MIN_QUALITY
      recommendations.push(`${supplier.name}: Enhance quality control processes`);
      if (performance.qualityScore < 70) {
        recommendations.push(`${supplier.name}: Consider quality management system certification (ISO 9001)`);
      }
    }

    if (performance.responseTime > 24) { // Assuming hours
      recommendations.push(`${supplier.name}: Improve response time to communications and requests`);
      if (performance.responseTime > 48) {
        recommendations.push(`${supplier.name}: Establish dedicated communication protocols for urgent matters`);
      }
    }

    if (performance.issueResolution < 80) {
      recommendations.push(`${supplier.name}: Develop better issue resolution procedures`);
      if (performance.issueResolution < 60) {
        recommendations.push(`${supplier.name}: Implement escalation procedures for critical issues`);
      }
    }

    return recommendations;
  }

  /**
   * Generate communication-related recommendations
   */
  static generateCommunicationRecommendations(supplier: Supplier): string[] {
    const recommendations: string[] = [];

    if (!supplier.primaryContact || !supplier.primaryContact.email) {
      recommendations.push('Ensure complete contact information is provided');
    }

    if (!supplier.primaryContact?.phone) {
      recommendations.push('Provide primary contact phone number for urgent communications');
    }

    if (!supplier.website) {
      recommendations.push('Consider establishing an online presence with a company website');
    }

    // Check for alternative contacts
    if (!supplier.alternativeContacts || supplier.alternativeContacts.length === 0) {
      recommendations.push('Designate backup contacts to ensure communication continuity');
    }

    // Email format validation
    if (supplier.primaryContact?.email && !this.isValidEmail(supplier.primaryContact.email)) {
      recommendations.push('Verify and update email address format');
    }

    return recommendations;
  }

  /**
   * Generate business development recommendations
   */
  static generateBusinessRecommendations(
    supplier: Supplier,
    overallScore: number
  ): string[] {
    const recommendations: string[] = [];

    // Preferred status recommendations
    if (!supplier.isPreferred && overallScore > 85) { // RECOMMENDATION_THRESHOLDS.PREFERRED_SCORE
      recommendations.push('Consider for preferred supplier status based on excellent performance');
    } else if (supplier.isPreferred && overallScore < 70) {
      recommendations.push('Review preferred supplier status - performance below expectations');
    }

    // Category expansion
    if (!supplier.categories || supplier.categories.length === 1) {
      recommendations.push('Explore opportunities to expand service categories');
    }

    // Certification recommendations
    if (!supplier.certifications || supplier.certifications.length === 0) {
      recommendations.push('Pursue relevant industry certifications to enhance credibility');
    }

    // Geographic expansion — serviceAreas not in core type, so suggest expansion only by score
    if (overallScore > 80) {
      recommendations.push('Consider expanding service areas to increase business opportunities');
    }

    // Contract and commercial recommendations
    if (overallScore > 75) {
      recommendations.push('Explore long-term contract opportunities for mutual benefit');
    }

    return recommendations;
  }

  /**
   * Get supplier rating
   */
  private static getSupplierRating(supplier: Supplier): number {
    if (typeof supplier.rating === 'number') {
      return supplier.rating;
    }
    if (supplier.rating && typeof supplier.rating === 'object') {
      return supplier.rating.overall ?? 0;
    }
    return 0;
  }

  /**
   * Validate email format
   */
  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Check if supplier has complete contact information
   */
  static hasCompleteContact(supplier: Supplier): boolean {
    return !!(
      supplier.primaryContact &&
      supplier.primaryContact.email &&
      supplier.primaryContact.phone
    );
  }

  /**
   * Calculate recommendation urgency
   */
  static calculateUrgency(overallScore: number, compliance: ComplianceInfo): 'critical' | 'high' | 'medium' | 'low' {
    if (overallScore < 50 || compliance.score < 50) {
      return 'critical';
    }
    if (overallScore < 70 || compliance.score < 70) {
      return 'high';
    }
    if (overallScore < 85 || compliance.score < 85) {
      return 'medium';
    }
    return 'low';
  }
}