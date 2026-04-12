/**
 * Enhanced Generator
 * Advanced scorecard generation with regional and category benchmarks
 */

import { Supplier, ComplianceStatus } from '@/types/supplier/base.types';
import { ProductCategory } from '@/types/supplier/common.types';
import { log } from '@/lib/logger';
import type {
  ScorecardGenerationResult,
  EnhancedScorecardResult,
  PriorityRecommendation,
} from './service-types';

export class ScorecardEnhancedGenerator {
  /**
   * Generate scorecard with enhanced analytics
   */
  static async generateEnhancedScorecard(
    supplierId: string,
    includeRegionalBenchmarks: boolean = true,
    includeCategoryBenchmarks: boolean = true,
    generateBaseScorecard: (id: string) => Promise<ScorecardGenerationResult>,
    getSupplier: (id: string) => Promise<Supplier>
  ): Promise<EnhancedScorecardResult> {
    const baseResult = await generateBaseScorecard(supplierId);
    const supplier = await getSupplier(supplierId);

    const enhanced: EnhancedScorecardResult = { ...baseResult };

    if (includeRegionalBenchmarks) {
      try {
        enhanced.regionalBenchmarks = await this.calculateRegionalBenchmarks(supplier);
      } catch (error) {
        baseResult.warnings.push('Failed to calculate regional benchmarks');
      }
    }

    if (includeCategoryBenchmarks && supplier.categories && supplier.categories.length > 0) {
      try {
        const categoryBenchmarks = await Promise.all(
          supplier.categories.map(category =>
            this.calculateCategoryBenchmarks(supplier, category)
          )
        );
        enhanced.categoryBenchmarks = categoryBenchmarks;
      } catch (error) {
        baseResult.warnings.push('Failed to calculate category benchmarks');
      }
    }

    // Generate priority recommendations
    try {
      enhanced.priorityRecommendations = await this.generatePriorityRecommendations(
        supplier,
        baseResult.scorecard.overallScore
      );
    } catch (error) {
      baseResult.warnings.push('Failed to generate priority recommendations');
    }

    return enhanced;
  }

  /**
   * Calculate regional benchmarks
   */
  private static async calculateRegionalBenchmarks(supplier: Supplier): Promise<{
    regionalPercentile: number;
    regionalAverage: number;
    topRegionalSuppliers: Array<{ name: string; score: number }>;
  }> {
    try {
      // Get all suppliers in the same region
      const supplierCrudService = await import('../../supplier.crud');
      const allSuppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      // Filter by region (if supplier has region data — not in core Supplier type)
      const supplierExt = supplier as unknown as Record<string, unknown>;
      const supplierRegion = (supplierExt['region'] as string | undefined) ?? 'Unknown';
      const regionalSuppliers = allSuppliers.filter(s =>
        (s as unknown as Record<string, unknown>)['region'] === supplierRegion
      );

      if (regionalSuppliers.length === 0) {
        return {
          regionalPercentile: 50,
          regionalAverage: 0,
          topRegionalSuppliers: []
        };
      }

      // Calculate scores for regional suppliers
      const { ScorecardScoreCalculator } = await import('../scorecard-generator');
      const regionalScores = regionalSuppliers.map(s => ({
        supplier: s,
        score: ScorecardScoreCalculator.calculateOverallScore(s)
      }));

      const supplierScore = ScorecardScoreCalculator.calculateOverallScore(supplier);
      const sortedScores = regionalScores
        .map(rs => rs.score)
        .sort((a, b) => a - b);

      const regionalPercentile = ScorecardScoreCalculator.calculatePercentile(supplierScore, sortedScores);
      const regionalAverage = regionalScores.reduce((sum, rs) => sum + rs.score, 0) / regionalScores.length;

      const topRegionalSuppliers = regionalScores
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(rs => ({
          name: rs.supplier.companyName || rs.supplier.name || 'Unknown',
          score: rs.score
        }));

      return {
        regionalPercentile: Math.round(regionalPercentile),
        regionalAverage: Math.round(regionalAverage),
        topRegionalSuppliers
      };
    } catch (error) {
      log.error('Error calculating regional benchmarks:', { data: error }, 'enhanced-generator');
      return {
        regionalPercentile: 50,
        regionalAverage: 0,
        topRegionalSuppliers: []
      };
    }
  }

  /**
   * Calculate category-specific benchmarks
   */
  private static async calculateCategoryBenchmarks(
    supplier: Supplier, 
    category: ProductCategory
  ): Promise<{
    category: string;
    categoryPercentile: number;
    categoryAverage: number;
    categoryLeaders: Array<{ name: string; score: number }>;
  }> {
    try {
      // Get all suppliers in the same category
      const supplierCrudService = await import('../../supplier.crud');
      const allSuppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      const categorySuppliers = allSuppliers.filter(s => 
        s.categories?.includes(category)
      );

      if (categorySuppliers.length === 0) {
        return {
          category,
          categoryPercentile: 50,
          categoryAverage: 0,
          categoryLeaders: []
        };
      }

      // Calculate scores for category suppliers
      const { ScorecardScoreCalculator } = await import('../scorecard-generator');
      const categoryScores = categorySuppliers.map(s => ({
        supplier: s,
        score: ScorecardScoreCalculator.calculateOverallScore(s)
      }));

      const supplierScore = ScorecardScoreCalculator.calculateOverallScore(supplier);
      const sortedScores = categoryScores
        .map(cs => cs.score)
        .sort((a, b) => a - b);

      const categoryPercentile = ScorecardScoreCalculator.calculatePercentile(supplierScore, sortedScores);
      const categoryAverage = categoryScores.reduce((sum, cs) => sum + cs.score, 0) / categoryScores.length;

      const categoryLeaders = categoryScores
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(cs => ({
          name: cs.supplier.companyName || cs.supplier.name || 'Unknown',
          score: cs.score
        }));

      return {
        category,
        categoryPercentile: Math.round(categoryPercentile),
        categoryAverage: Math.round(categoryAverage),
        categoryLeaders
      };
    } catch (error) {
      log.error(`Error calculating category benchmarks for ${category}:`, { data: error }, 'enhanced-generator');
      return {
        category,
        categoryPercentile: 50,
        categoryAverage: 0,
        categoryLeaders: []
      };
    }
  }

  /**
   * Generate priority recommendations with enhanced analysis
   */
  private static async generatePriorityRecommendations(
    supplier: Supplier,
    overallScore: number
  ): Promise<PriorityRecommendation[]> {
    const recommendations: PriorityRecommendation[] = [];

    // Critical recommendations (score < 50)
    if (overallScore < 50) {
      recommendations.push({
        priority: 'critical',
        category: 'Performance',
        recommendation: 'Immediate supplier performance review and improvement plan required',
        impact: 'high',
        effort: 'high',
        timeline: '1-2 weeks'
      });
    }

    // High priority recommendations (score < 70)
    if (overallScore < 70) {
      recommendations.push({
        priority: 'high',
        category: 'Quality',
        recommendation: 'Implement quality improvement initiative',
        impact: 'high',
        effort: 'medium',
        timeline: '1-3 months'
      });
    }

    // Check compliance
    const compliance = supplier.complianceStatus;
    // Calculate basic compliance score
    const complianceScore = this.calculateBasicComplianceScore(compliance);
    if (complianceScore > 0 && complianceScore < 80) {
      recommendations.push({
        priority: 'high',
        category: 'Compliance',
        recommendation: 'Update compliance documentation and certifications',
        impact: 'high',
        effort: 'medium',
        timeline: '2-4 weeks'
      });
    }

    // Performance-specific recommendations — check on-time deliveries from metrics
    const performance = supplier.performance;
    const onTimeDeliveryRate = performance?.metrics?.onTimeDeliveries != null
      ? (performance.metrics.onTimeDeliveries / Math.max(performance.metrics.totalOrders, 1)) * 100
      : null;
    if (onTimeDeliveryRate !== null && onTimeDeliveryRate < 90) {
      recommendations.push({
        priority: 'medium',
        category: 'Delivery',
        recommendation: 'Improve delivery time consistency and logistics',
        impact: 'medium',
        effort: 'medium',
        timeline: '2-3 months'
      });
    }

    // Preferred status recommendations
    if (!supplier.isPreferred && overallScore > 85) {
      recommendations.push({
        priority: 'low',
        category: 'Strategic',
        recommendation: 'Evaluate for preferred supplier status',
        impact: 'medium',
        effort: 'low',
        timeline: '1 month'
      });
    }

    return recommendations.slice(0, 5); // Limit to top 5 priority recommendations
  }

  /**
   * Calculate ROI impact for recommendations
   */
  static calculateRecommendationROI(
    recommendations: PriorityRecommendation[]
  ): Array<{
    recommendation: PriorityRecommendation;
    roiScore: number;
    priorityRank: number;
  }> {
    const impactScores = { high: 3, medium: 2, low: 1 };
    const effortScores = { high: 3, medium: 2, low: 1 };
    const priorityScores = { critical: 4, high: 3, medium: 2, low: 1 };

    return recommendations.map((rec, index) => ({
      recommendation: rec,
      roiScore: (impactScores[rec.impact] * priorityScores[rec.priority]) / effortScores[rec.effort],
      priorityRank: index + 1
    })).sort((a, b) => b.roiScore - a.roiScore);
  }

  /**
   * Calculate basic compliance score from available data
   */
  private static calculateBasicComplianceScore(compliance: ComplianceStatus | undefined): number {
    if (!compliance) return 0;

    let score = 0;
    let factors = 0;

    const ext = compliance as unknown as Record<string, unknown>;
    if (compliance.taxCompliant) { score += 30; factors++; }
    if (compliance.beeCompliant) { score += 25; factors++; }
    if (ext['isoCompliant']) { score += 25; factors++; }
    if (ext['documentsVerified']) { score += 20; factors++; }

    return factors > 0 ? score : 0;
  }
}