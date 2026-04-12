/**
 * Recommendation Engine
 * Generate improvement recommendations and compliance analysis
 */

import { Supplier } from '@/types/supplier/base.types';
import { ProductCategory } from '@/types/supplier/common.types';
import type { SupplierPerformance } from '@/types/supplier/performance.types';
import { ScorecardScoreCalculator } from './score-calculator';
import type { ComplianceData } from './scorecard-types';

export class ScorecardRecommendationEngine {
  /**
   * Extract compliance information
   */
  static extractCompliance(supplier: Supplier): ComplianceData {
    const compliance = supplier.complianceStatus;
    
    // Calculate compliance score from available compliance data
    let score = 0;
    if (compliance) {
      let factors = 0;
      let totalScore = 0;
      
      if (compliance.taxCompliant) {
        totalScore += 30; // 30% for tax compliance
        factors++;
      }
      
      if (compliance.beeCompliant) {
        totalScore += 25; // 25% for BEE compliance
        factors++;
      }
      
      if (compliance.isoCompliant) {
        totalScore += 25; // 25% for ISO compliance
        factors++;
      }
      
      if (compliance.documentsVerified) {
        totalScore += 20; // 20% for document verification
        factors++;
      }
      
      score = factors > 0 ? totalScore : 0;
    }
    
    return {
      score,
      status: this.determineComplianceStatus(score),
      lastCheck: compliance?.lastAuditDate ? new Date(compliance.lastAuditDate) : new Date()
    };
  }

  /**
   * Generate improvement recommendations
   */
  static generateRecommendations(
    supplier: Supplier, 
    overallScore: number, 
    compliance: ComplianceData
  ): string[] {
    const recommendations: string[] = [];

    // Score-based recommendations
    if (overallScore < 60) {
      recommendations.push('Critical improvement needed across all performance areas');
      recommendations.push('Schedule immediate supplier development meeting');
    } else if (overallScore < 80) {
      recommendations.push('Focus on key performance improvement areas');
    }

    // Rating-based recommendations
    const rating = ScorecardScoreCalculator.getSupplierRating(supplier);
    if (rating < 3.5) {
      recommendations.push('Improve service quality and customer satisfaction');
      if (rating < 2.5) {
        recommendations.push('Consider supplier replacement due to poor performance');
      }
    }

    // Compliance recommendations
    if (compliance.score < 80) {
      recommendations.push('Update compliance documentation and certifications');
      if (compliance.score < 60) {
        recommendations.push('Urgent compliance review required - risk of non-compliance');
      }
    }

    // Performance-specific recommendations
    const performance: SupplierPerformance | undefined = supplier.performance;
    const deliveryScore = performance?.deliveryScore;
    if (deliveryScore !== undefined && deliveryScore < 90) {
      recommendations.push('Improve delivery time consistency');
      if (deliveryScore < 70) {
        recommendations.push('Implement delivery performance improvement plan');
      }
    }

    const qualityScore = performance?.qualityScore;
    if (qualityScore !== undefined && qualityScore < 85) {
      recommendations.push('Enhance quality control processes');
      if (qualityScore < 70) {
        recommendations.push('Conduct quality audit and implement corrective actions');
      }
    }

    // Communication recommendations
    if (!supplier.primaryContact || !supplier.primaryContact.email) {
      recommendations.push('Ensure complete contact information is provided');
    }

    // Preferred status recommendations
    if (!supplier.isPreferred && overallScore > 85) {
      recommendations.push('Consider for preferred supplier status based on excellent performance');
    } else if (supplier.isPreferred && overallScore < 70) {
      recommendations.push('Review preferred supplier status - performance below expectations');
    }

    // Category-specific recommendations
    this.addCategorySpecificRecommendations(supplier, recommendations);

    // Contract and commercial recommendations
    this.addCommercialRecommendations(supplier, overallScore, recommendations);

    // Default recommendation if none identified
    if (recommendations.length === 0) {
      recommendations.push('Maintain current excellent performance standards');
    }

    return recommendations.slice(0, 8); // Limit to top 8 recommendations
  }

  /**
   * Determine compliance status string
   */
  static determineComplianceStatus(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Good';
    if (score >= 60) return 'Acceptable';
    if (score >= 40) return 'Needs Improvement';
    return 'Critical';
  }

  /**
   * Add category-specific recommendations
   */
  private static addCategorySpecificRecommendations(supplier: Supplier, recommendations: string[]): void {
    const categories = supplier.categories || [];
    
    if (categories.includes(ProductCategory.SOFTWARE)) {
      const techScore = supplier.performance?.serviceScore || 0;
      if (techScore < 80) {
        recommendations.push('Upgrade technology capabilities and infrastructure');
      }
    }

    if (categories.includes(ProductCategory.HARDWARE)) {
      const qualityScore = supplier.performance?.qualityScore || 0;
      if (qualityScore < 85) {
        recommendations.push('Implement lean manufacturing and quality management systems');
      }
    }

    if (categories.includes(ProductCategory.SERVICES)) {
      const deliveryScore = supplier.performance?.deliveryScore || 0;
      if (deliveryScore < 90) {
        recommendations.push('Optimize supply chain and logistics processes');
      }
    }
  }

  /**
   * Add commercial recommendations
   */
  private static addCommercialRecommendations(
    supplier: Supplier, 
    overallScore: number, 
    recommendations: string[]
  ): void {
    // Pricing recommendations — use priceScore as proxy for competitive pricing
    const priceScore = supplier.performance?.priceScore;
    const hasCompetitivePricing = priceScore === undefined || priceScore >= 70;
    if (!hasCompetitivePricing && overallScore > 75) {
      recommendations.push('Negotiate pricing improvements given strong performance');
    }

    // Contract recommendations
    const contractStatus = supplier.status;
    if (contractStatus === 'pending' && overallScore > 80) {
      recommendations.push('Prioritize contract finalization for high-performing supplier');
    }

    // Risk recommendations
    if (overallScore < 60) {
      recommendations.push('Develop supplier risk mitigation plan');
    }

    // Innovation recommendations
    if (overallScore > 85) {
      recommendations.push('Explore innovation partnership opportunities');
    }
  }

  /**
   * Generate priority action items
   */
  static generatePriorityActions(
    supplier: Supplier,
    overallScore: number,
    compliance: ComplianceData
  ): Array<{ priority: 'high' | 'medium' | 'low'; action: string; timeline: string }> {
    const actions: Array<{ priority: 'high' | 'medium' | 'low'; action: string; timeline: string }> = [];

    // High priority actions
    if (overallScore < 50) {
      actions.push({
        priority: 'high',
        action: 'Immediate supplier review and development plan',
        timeline: '1 week'
      });
    }

    if (compliance.score < 60) {
      actions.push({
        priority: 'high',
        action: 'Compliance audit and corrective action plan',
        timeline: '2 weeks'
      });
    }

    // Medium priority actions
    if (overallScore < 75) {
      actions.push({
        priority: 'medium',
        action: 'Performance improvement initiative',
        timeline: '1 month'
      });
    }

    // Low priority actions
    if (overallScore > 85 && !supplier.isPreferred) {
      actions.push({
        priority: 'low',
        action: 'Evaluate for preferred supplier program',
        timeline: '3 months'
      });
    }

    return actions;
  }
}