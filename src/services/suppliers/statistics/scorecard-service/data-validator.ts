/**
 * Data Validator
 * Data quality validation and reliability calculation for scorecards
 */

import { Supplier } from '@/types/supplier/base.types';

export class ScorecardDataValidator {
  /**
   * Validate supplier data for scorecard generation
   */
  static validateSupplierData(supplier: Supplier): {
    isValid: boolean;
    completeness: number;
    issues: string[];
    missingFields: string[];
    dataQualityScore: number;
  } {
    const issues: string[] = [];
    const missingFields: string[] = [];
    let completeness = 100;

    // Check required fields
    const requiredFields = [
      { field: 'name', weight: 10 },
      { field: 'primaryContact', weight: 15 },
      { field: 'status', weight: 10 }
    ];

    requiredFields.forEach(({ field, weight }) => {
      if (!this.hasValidValue((supplier as unknown as Record<string, unknown>)[field])) {
        missingFields.push(field);
        completeness -= weight;
        issues.push(`Missing or invalid ${field}`);
      }
    });

    // Check optional but important fields
    const optionalFields = [
      { field: 'companyName', weight: 5 },
      { field: 'categories', weight: 10 },
      { field: 'performance', weight: 20 },
      { field: 'complianceStatus', weight: 15 },
      { field: 'rating', weight: 15 }
    ];

    optionalFields.forEach(({ field, weight }) => {
      if (!this.hasValidValue((supplier as unknown as Record<string, unknown>)[field])) {
        completeness -= weight;
        issues.push(`Missing ${field} data`);
      }
    });

    // Validate contact information
    if (supplier.primaryContact) {
      if (!supplier.primaryContact.email) {
        issues.push('Missing primary contact email');
        completeness -= 5;
      } else if (!this.isValidEmail(supplier.primaryContact.email)) {
        issues.push('Invalid primary contact email format');
        completeness -= 3;
      }

      if (!supplier.primaryContact.phone) {
        issues.push('Missing primary contact phone');
        completeness -= 3;
      }
    }

    // Validate performance data
    if (supplier.performance) {
      const performance = supplier.performance as unknown as Record<string, unknown>;
      const performanceFields = ['onTimeDelivery', 'qualityScore', 'responseTime'];

      performanceFields.forEach(field => {
        const fieldVal = performance[field];
        if (typeof fieldVal !== 'number' || fieldVal < 0 || fieldVal > 100) {
          issues.push(`Invalid performance ${field} value`);
        }
      });
    }

    // Validate compliance data
    if (supplier.complianceStatus) {
      // Note: complianceScore property doesn't exist in ComplianceStatus interface
      // We'll validate available properties instead
      
      if (!supplier.complianceStatus.lastAuditDate) {
        issues.push('Missing compliance audit date');
      }
    }

    // Validate rating data
    if (supplier.rating) {
      if (typeof supplier.rating === 'number') {
        if (supplier.rating < 0 || supplier.rating > 5) {
          issues.push('Invalid rating value (should be 0-5)');
        }
      } else if (typeof supplier.rating === 'object') {
        const rating = supplier.rating as Record<string, unknown>;
        if (typeof rating['overall'] !== 'number' || (rating['overall'] as number) < 0 || (rating['overall'] as number) > 5) {
          issues.push('Invalid overall rating value');
        }
      }
    }

    const dataQualityScore = this.calculateDataQualityScore(supplier, completeness, issues.length);

    return {
      isValid: completeness >= 60 && issues.length < 5,
      completeness: Math.max(0, Math.min(100, completeness)),
      issues,
      missingFields,
      dataQualityScore
    };
  }

  /**
   * Calculate data reliability score
   */
  static calculateDataReliability(supplier: Supplier, warnings: string[]): number {
    let reliabilityScore = 100;

    // Reduce score based on warnings
    reliabilityScore -= warnings.length * 10;

    // Check data freshness
    const lastUpdated = supplier.updatedAt || supplier.createdAt;
    if (lastUpdated) {
      const daysSinceUpdate = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate > 90) {
        reliabilityScore -= 20; // Old data penalty
      } else if (daysSinceUpdate > 30) {
        reliabilityScore -= 10; // Moderately old data penalty
      }
    } else {
      reliabilityScore -= 15; // No update timestamp penalty
    }

    // Check for data consistency
    const consistencyScore = this.checkDataConsistency(supplier);
    reliabilityScore = (reliabilityScore + consistencyScore) / 2;

    return Math.max(0, Math.min(100, reliabilityScore));
  }

  /**
   * Check if supplier ID is valid
   */
  static isValidSupplierId(supplierId: string): boolean {
    if (!supplierId || typeof supplierId !== 'string') {
      return false;
    }

    // Basic validation - adjust based on your ID format requirements
    return supplierId.trim().length > 0 && supplierId.length <= 50;
  }

  /**
   * Get supplier display name
   */
  static getSupplierDisplayName(supplier: Supplier): string {
    return supplier.companyName || supplier.name || 'Unknown Supplier';
  }

  /**
   * Check if a value is valid (not null, undefined, or empty string)
   */
  private static hasValidValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === 'object') {
      return Object.keys(value).length > 0;
    }

    return true;
  }

  /**
   * Validate email format
   */
  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Calculate overall data quality score
   */
  private static calculateDataQualityScore(supplier: Supplier, completeness: number, issueCount: number): number {
    let qualityScore = completeness;

    // Penalize for data issues
    qualityScore -= issueCount * 5;

    // Bonus for high-quality data
    if (supplier.performance && supplier.complianceStatus && supplier.rating) {
      qualityScore += 10; // Comprehensive data bonus
    }

    // Check for data freshness bonus
    const lastUpdated = supplier.updatedAt || supplier.createdAt;
    if (lastUpdated) {
      const daysSinceUpdate = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate <= 7) {
        qualityScore += 5; // Fresh data bonus
      }
    }

    return Math.max(0, Math.min(100, qualityScore));
  }

  /**
   * Check data consistency
   */
  private static checkDataConsistency(supplier: Supplier): number {
    let consistencyScore = 100;

    // Check if status matches performance
    if (supplier.status === 'active' && supplier.performance) {
      const performance = supplier.performance as unknown as Record<string, unknown>;
      const overallScore = performance['overallScore'];
      if (typeof overallScore === 'number' && overallScore < 40) {
        consistencyScore -= 10; // Active supplier with poor performance
      }
    }

    // Check if preferred status matches rating
    if (supplier.isPreferred && supplier.rating) {
      const rating = typeof supplier.rating === 'number'
        ? supplier.rating
        : ((supplier.rating as Record<string, unknown>)['overall'] as number | undefined) ?? 0;
      
      if (rating < 3.5) {
        consistencyScore -= 15; // Preferred supplier with low rating
      }
    }

    // Check compliance vs status consistency
    if (supplier.status === 'active' && supplier.complianceStatus) {
      // Calculate basic compliance score from available data
      let complianceFactors = 0;
      if (supplier.complianceStatus.taxCompliant) complianceFactors++;
      if (supplier.complianceStatus.beeCompliant) complianceFactors++;
      if (supplier.complianceStatus.isoCompliant) complianceFactors++;
      
      if (complianceFactors < 2) {
        consistencyScore -= 10; // Active supplier with poor compliance
      }
    }

    return Math.max(0, Math.min(100, consistencyScore));
  }

  /**
   * Generate data improvement recommendations
   */
  static generateDataImprovementRecommendations(supplier: Supplier): string[] {
    const validation = this.validateSupplierData(supplier);
    const recommendations: string[] = [];

    if (validation.completeness < 70) {
      recommendations.push('Complete missing supplier information to improve scorecard accuracy');
    }

    if (validation.missingFields.includes('performance')) {
      recommendations.push('Add performance metrics for more accurate scoring');
    }

    if (validation.missingFields.includes('complianceStatus')) {
      recommendations.push('Update compliance information for comprehensive evaluation');
    }

    if (validation.issues.some(issue => issue.includes('email'))) {
      recommendations.push('Verify and update contact email information');
    }

    const lastUpdated = supplier.updatedAt || supplier.createdAt;
    if (lastUpdated) {
      const daysSinceUpdate = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate > 60) {
        recommendations.push('Update supplier information - data is outdated');
      }
    }

    return recommendations;
  }
}