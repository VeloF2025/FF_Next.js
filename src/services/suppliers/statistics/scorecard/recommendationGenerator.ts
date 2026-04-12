/**
 * Recommendation Generator Module - Legacy Compatibility Layer
 * @deprecated Use modular components from '../recommendation-generator' instead
 * This file maintains backward compatibility for existing imports
 * New code should import from '../recommendation-generator' directly
 */

import { Supplier } from '@/types/supplier/base.types';
import { ComplianceInfo } from './types';
import {
  CoreRecommendationEngine,
  RecommendationPriorityAnalyzer,
  RecommendationIndustrySpecialist,
  type RecommendationItem
} from '../recommendation-generator';
import type { SupplierPerformanceInput } from '../recommendation-generator/core-recommendations';

export class RecommendationGenerator {
  /**
   * Generate comprehensive improvement recommendations
   * @deprecated Use CoreRecommendationEngine.generateRecommendations instead
   */
  static generateRecommendations(
    supplier: Supplier,
    overallScore: number,
    compliance: ComplianceInfo,
    performanceMetrics?: SupplierPerformanceInput
  ): string[] {
    return CoreRecommendationEngine.generateRecommendations(
      supplier,
      overallScore,
      compliance,
      performanceMetrics
    );
  }

  /**
   * Generate priority-based recommendations
   * @deprecated Use RecommendationPriorityAnalyzer.generatePriorityRecommendations instead
   */
  static generatePriorityRecommendations(
    supplier: Supplier,
    overallScore: number,
    compliance: ComplianceInfo,
    performanceMetrics?: SupplierPerformanceInput
  ): Array<{
    recommendation: string;
    priority: 'high' | 'medium' | 'low';
    category: 'compliance' | 'performance' | 'communication' | 'business';
    impact: string;
    timeline: string;
  }> {
    const priorityRecs = RecommendationPriorityAnalyzer.generatePriorityRecommendations(
      supplier,
      overallScore,
      compliance,
      performanceMetrics
    );

    // Convert to legacy format
    return priorityRecs.map(rec => ({
      recommendation: rec.recommendation,
      priority: rec.priority === 'critical' ? 'high' : rec.priority,
      category: rec.category as 'compliance' | 'performance' | 'communication' | 'business',
      impact: rec.impact,
      timeline: rec.timeline
    }));
  }

  /**
   * Generate industry-specific recommendations
   * @deprecated Use RecommendationIndustrySpecialist.generateIndustryRecommendations instead
   */
  static generateIndustryRecommendations(
    supplier: Supplier,
    industryBenchmarks?: Record<string, unknown>
  ): string[] {
    return RecommendationIndustrySpecialist.generateIndustryRecommendations(
      supplier,
      industryBenchmarks
    );
  }

  /**
   * Generate actionable improvement plan
   * @deprecated Use RecommendationPriorityAnalyzer.generateImprovementPlan instead
   */
  static generateImprovementPlan(
    supplier: Supplier,
    recommendations: Array<{
      recommendation: string;
      priority: 'high' | 'medium' | 'low';
      category: string;
      impact: string;
      timeline: string;
    }>
  ): {
    immediate: string[];
    shortTerm: string[];
    mediumTerm: string[];
    longTerm: string[];
  } {
    // Convert legacy format to new format
    // Add supplier context to recommendations
    const supplierContext = `for ${supplier.name}`;
    const newFormatRecs: RecommendationItem[] = recommendations.map(rec => ({
      recommendation: `${rec.recommendation} ${supplierContext}`,
      priority: rec.priority === 'high' ? 'high' : rec.priority,
      category: rec.category as 'compliance' | 'performance' | 'communication' | 'business',
      impact: rec.impact,
      timeline: rec.timeline
    }));

    return RecommendationPriorityAnalyzer.generateImprovementPlan(newFormatRecs);
  }
}

// Re-export modular components for easier migration
export {
  CoreRecommendationEngine,
  RecommendationPriorityAnalyzer,
  RecommendationIndustrySpecialist
} from '../recommendation-generator';